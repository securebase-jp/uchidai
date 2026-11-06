/**
 * セキュリティ診断（docs/security-review-2026-11-06.md）で確かめた、API サーバの振る舞い。
 * app.request で手元の app にだけ要求する。外へ出る通信はしない（Claude のキーは外して記録の再生にする）。
 * 「通ってしまう」ことを記録する試験も含む（直すときに、ここを反転させる）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "./app.ts";

// biome-ignore lint/suspicious/noExplicitAny: テストでは応答の形を緩く読む
type Loose = any;
const loose = async (res: Response | Promise<Response>): Promise<Loose> => (await res).json();

let savedKey: string | undefined;
beforeAll(() => {
  savedKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
});
afterAll(() => {
  if (savedKey !== undefined) process.env.ANTHROPIC_API_KEY = savedKey;
});

const answers = {
  industry: "healthcare",
  site: "clinic",
  hosting: { mail: "cloud", files: "onprem", core: "onprem", web: "provider" },
  remoteAccess: ["vpn"],
  backup: "same_network",
};

describe("SEC-001：他サイトからの要求（CSRF）を見分ける材料が無い", () => {
  it("content-type が text/plain でも JSON として処理する（プリフライト無しの単純リクエストが通る）", async () => {
    const res = await app.request("/api/profile/from-answers", {
      method: "POST",
      headers: { "content-type": "text/plain", origin: "https://evil.example" },
      body: JSON.stringify({ answers }),
    });
    expect(res.status).toBe(200);
    // CORS は応答を読ませないだけで、処理そのものは止めない
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect((await loose(res)).profile).toBeDefined();
  });
  it("Origin が手元以外でも、Sec-Fetch-Site が cross-site でも断らない", async () => {
    const res = await app.request("/api/profile/from-answers", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://evil.example",
        "sec-fetch-site": "cross-site",
        "sec-fetch-mode": "no-cors",
      },
      body: JSON.stringify({ answers }),
    });
    expect(res.status).toBe(200);
  });
  it("Host ヘッダが手元以外でも断らない（DNS の付け替えで応答まで読まれる前提条件）", async () => {
    const res = await app.request("/api/examples", { headers: { host: "attacker.example:8787" } });
    expect(res.status).toBe(200);
    expect((await loose(res)).items.length).toBeGreaterThan(0);
  });
  it("送信箱を空にする DELETE はプリフライトが要るので、手元以外の Origin のプリフライトには許可を返さない", async () => {
    const res = await app.request("/api/requests", {
      method: "OPTIONS",
      headers: {
        origin: "https://evil.example",
        "access-control-request-method": "DELETE",
      },
    });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("SEC-002：remote-guard は転送ヘッダが無ければ外からの要求でも通す（fail-open）", () => {
  it("転送ヘッダを付けない要求は、どこから来ても手元扱い", async () => {
    // Node の socket の相手アドレスは見ていない。転送ヘッダを足さない中継（単純な nginx、ssh のポート転送、
    // API_HOST=0.0.0.0 で直接公開）では、送信箱や判定の API がそのまま使える
    const res = await app.request("/api/requests", { headers: { host: "203.0.113.10:8787" } });
    expect(res.status).toBe(200);
  });
  it("転送ヘッダが付けば、health と sources 以外は 403", async () => {
    const h = { "x-forwarded-for": "203.0.113.5" };
    expect((await app.request("/api/requests", { headers: h })).status).toBe(403);
    expect((await app.request("/api/examples", { headers: h })).status).toBe(403);
    expect((await app.request("/api/kev/status", { headers: h })).status).toBe(403);
    expect((await app.request("/api/recon/status?domain=example.com", { headers: h })).status).toBe(
      403,
    );
    expect((await app.request("/api/demo/audio", { headers: h })).status).toBe(403);
    expect((await app.request("/api/health", { headers: h })).status).toBe(200);
  });
});

describe("AI攻撃者の記録の読み込み（問題なかったもの）：カルテの id は英数字とハイフンだけに絞られる", () => {
  const profile = async () => (await loose(app.request("/api/examples/demo-seiko"))).profile;
  const recon = async (id: string) =>
    app.request("/api/attacker/recon", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profile: { ...(await profile()), id }, replay: true }),
    });

  it("id に ../ を含めても eval/recordings の外の .json は開かず、存在するかどうかも分からない", async () => {
    // loadAttackerRecording は id を /^[a-z0-9][a-z0-9-]{0,63}$/ で検査してから join する
    for (const id of [
      "../../../package",
      "../../../examples/demo-seiko",
      "../../../no-such-file",
    ]) {
      const res = await recon(id);
      expect(res.status).toBe(200);
      expect((await loose(res)).meta.unavailable).toBeDefined();
    }
  });
  it("比較（/compare）の caseId は zod で英数字とハイフンだけに絞られている", async () => {
    const res = await app.request("/api/attacker/compare", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ caseId: "../../../package", verdict: {} }),
    });
    expect(res.status).toBe(400);
    expect(JSON.stringify((await loose(res)).details)).toContain("caseId");
  });
});

describe("ファイル名に入る ID の検査（問題なかったもの）", () => {
  it("examples と recorded の ID は英数字とハイフンだけ", async () => {
    expect((await app.request("/api/examples/..%2F..%2Fpackage")).status).toBe(400);
    expect((await app.request("/api/examples/demo-seiko%00")).status).toBe(400);
    expect((await app.request("/api/case/recorded/..%2F..%2Fpackage")).status).toBe(400);
  });
  it("デモ音声の場面番号は 1〜50 の整数だけ", async () => {
    expect((await app.request("/api/demo/audio/..%2F..%2Fpackage")).status).toBe(400);
    expect((await app.request("/api/demo/audio/0")).status).toBe(400);
    expect((await app.request("/api/demo/audio/51")).status).toBe(400);
    expect([200, 404]).toContain((await app.request("/api/demo/audio/1")).status);
  });
});

describe("エラー応答（問題なかったもの）", () => {
  it("壊れた JSON・形の違う入力は 400 で、スタックやパスを含まない", async () => {
    const broken = await app.request("/api/evaluate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    expect(broken.status).toBe(400);
    const text = await broken.text();
    expect(text).not.toMatch(/\/Users\/|\/home\/|node_modules|at .* \(/);
    const wrong = await app.request("/api/evaluate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ case: 1 }),
    });
    expect(wrong.status).toBe(400);
    expect(await wrong.text()).not.toMatch(/\/Users\/|\/home\/|node_modules/);
  });
  it("/api/health はキーの有無だけを返す", async () => {
    const body = await loose(app.request("/api/health"));
    expect(Object.keys(body).sort()).toEqual(["ok", "readAvailable"]);
  });
});
