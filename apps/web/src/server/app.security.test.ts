/**
 * セキュリティ診断（docs/security-review-2026-11-06.md）で確かめた、API サーバの振る舞い。
 * app.request で手元の app にだけ要求する。外へ出る通信はしない（Claude のキーは外して記録の再生にする）。
 * 「通ってしまう」ことを記録する試験も含む（直すときに、ここを反転させる）。
 */
import { Hono } from "hono";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { app } from "./app.ts";
import { hostGuard } from "./host-guard.ts";
import { RateLimitError, RateWindow, resetClaudeLimits } from "./limits.ts";

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

const post = (path: string, body: unknown, headers: Record<string, string>) =>
  app.request(path, { method: "POST", headers, body: JSON.stringify(body) });

describe("SEC-002（対応済み）：他サイトのページからの要求を断る", () => {
  it("content-type が text/plain（プリフライト無しの単純リクエスト）は 415", async () => {
    const res = await post(
      "/api/profile/from-answers",
      { answers },
      { "content-type": "text/plain", origin: "https://evil.example" },
    );
    expect(res.status).toBe(403); // Origin が手元でないので、content-type より先に 403
    const noOrigin = await post(
      "/api/profile/from-answers",
      { answers },
      { "content-type": "text/plain" },
    );
    expect(noOrigin.status).toBe(415);
  });
  it("Sec-Fetch-Site が cross-site、または Origin が手元以外なら 403", async () => {
    const cross = await post(
      "/api/profile/from-answers",
      { answers },
      { "content-type": "application/json", "sec-fetch-site": "cross-site" },
    );
    expect(cross.status).toBe(403);
    const origin = await post(
      "/api/profile/from-answers",
      { answers },
      { "content-type": "application/json", origin: "https://evil.example" },
    );
    expect(origin.status).toBe(403);
    const nullOrigin = await post(
      "/api/profile/from-answers",
      { answers },
      { "content-type": "application/json", origin: "null" },
    );
    expect(nullOrigin.status).toBe(403);
  });
  it("画面（同じ生成元）、アドレス欄や curl（Sec-Fetch-Site が none か無し）は通る", async () => {
    const same = await post(
      "/api/profile/from-answers",
      { answers },
      {
        "content-type": "application/json",
        "sec-fetch-site": "same-origin",
        origin: "http://localhost:5173",
      },
    );
    expect(same.status).toBe(200);
    const none = await post(
      "/api/profile/from-answers",
      { answers },
      { "content-type": "application/json", "sec-fetch-site": "none" },
    );
    expect(none.status).toBe(200);
    const curl = await post(
      "/api/profile/from-answers",
      { answers },
      { "content-type": "application/json" },
    );
    expect(curl.status).toBe(200);
    expect((await loose(curl)).profile).toBeDefined();
  });
  it("SSE（GET /api/requests/events）も他サイトからは 403（SEC-012）。普通の GET は見ない", async () => {
    const sse = await app.request("/api/requests/events", {
      headers: { "sec-fetch-site": "cross-site" },
    });
    expect(sse.status).toBe(403);
    const get = await app.request("/api/examples", { headers: { "sec-fetch-site": "cross-site" } });
    expect(get.status).toBe(200);
  });
  it("送信箱を空にする DELETE はプリフライトが要るので、手元以外の Origin のプリフライトには許可を返さない", async () => {
    const res = await app.request("/api/requests", {
      method: "OPTIONS",
      headers: { origin: "https://evil.example", "access-control-request-method": "DELETE" },
    });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});

/** Node のサーバが渡す接続元の情報を模す（app.request の第 3 引数 env） */
const peer = (address: string) => ({
  incoming: { socket: { remoteAddress: address, remotePort: 50000, remoteFamily: "IPv4" } },
});

describe("SEC-004（対応済み）：転送ヘッダが無くても、接続元がループバックでなければ外から扱い", () => {
  it("接続元が取れないとき（app.request のテスト）は従来どおり手元扱い", async () => {
    const res = await app.request("/api/requests");
    expect(res.status).toBe(200);
  });
  it("接続元が公開アドレスなら、転送ヘッダが無くても health 以外は 403", async () => {
    expect((await app.request("/api/requests", {}, peer("203.0.113.5"))).status).toBe(403);
    expect((await app.request("/api/examples", {}, peer("203.0.113.5"))).status).toBe(403);
    expect((await app.request("/api/health", {}, peer("203.0.113.5"))).status).toBe(200);
    expect((await app.request("/api/sources", {}, peer("203.0.113.5"))).status).toBe(200);
  });
  it("接続元がループバックなら手元扱い（ZIP の起動処理は 127.0.0.1 に固定）", async () => {
    for (const a of ["127.0.0.1", "::1", "::ffff:127.0.0.1"])
      expect((await app.request("/api/requests", {}, peer(a))).status).toBe(200);
  });
  it("私設アドレスの接続元（Docker のブリッジ）は、UCHIDAI_TRUST_PRIVATE_PEER=1 が無い限り外から扱い", async () => {
    expect((await app.request("/api/requests", {}, peer("172.17.0.1"))).status).toBe(403);
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

describe("SEC-003（対応済み）：Host が手元の名前でなければ 421", () => {
  it("localhost・127.0.0.1・[::1]（任意のポート）と Host 無しは通る", async () => {
    for (const host of ["localhost", "localhost:5173", "127.0.0.1:8787", "[::1]:8787", "LOCALHOST"])
      expect((await app.request("/api/examples", { headers: { host } })).status).toBe(200);
    expect((await app.request("/api/examples")).status).toBe(200);
  });
  it("攻撃者のドメイン（DNS の付け替え）や LAN の名前は 421", async () => {
    for (const host of ["attacker.example:8787", "192.168.1.5:8787", "uchidai.local"]) {
      const res = await app.request("/api/examples", { headers: { host } });
      expect(res.status).toBe(421);
      expect((await loose(res)).error).toContain("UCHIDAI_ALLOWED_HOSTS");
    }
  });
  it("公開 URL（転送ヘッダつき）は remote-guard が見るので、Host は見ない", async () => {
    const res = await app.request("/api/health", {
      headers: { host: "xxxx.trycloudflare.com", "cf-connecting-ip": "203.0.113.5" },
    });
    expect(res.status).toBe(200);
  });
  it("Docker（私設アドレスの接続元を手元扱い）でも、Host が攻撃者のドメインなら 421", async () => {
    const guard = hostGuard({ remote: { trustPrivatePeer: true } });
    const mini = new Hono().use("/api/*", guard).get("/api/x", (c) => c.text("ok"));
    const env = {
      incoming: { socket: { remoteAddress: "172.17.0.1", remotePort: 5, remoteFamily: "IPv4" } },
    };
    expect(
      (await mini.request("/api/x", { headers: { host: "localhost:8787" } }, env)).status,
    ).toBe(200);
    expect(
      (await mini.request("/api/x", { headers: { host: "evil.example:8787" } }, env)).status,
    ).toBe(421);
    // 手元扱いにしない設定なら、私設アドレスからの要求は remote-guard の範囲（Host は見ない）
    const strict = new Hono()
      .use("/api/*", hostGuard({ remote: {} }))
      .get("/api/x", (c) => c.text("ok"));
    expect(
      (await strict.request("/api/x", { headers: { host: "evil.example:8787" } }, env)).status,
    ).toBe(200);
  });
  it("UCHIDAI_ALLOWED_HOSTS で足した名前は通る（ホスト名だけ、またはポート付きの完全一致）", async () => {
    const guard = hostGuard({ allowed: new Set(["uchidai.lan", "pc01:9000"]) });
    const mini = new Hono().use("/api/*", guard).get("/api/x", (c) => c.text("ok"));
    expect((await mini.request("/api/x", { headers: { host: "uchidai.lan:8787" } })).status).toBe(
      200,
    );
    expect((await mini.request("/api/x", { headers: { host: "pc01:9000" } })).status).toBe(200);
    expect((await mini.request("/api/x", { headers: { host: "pc01:9001" } })).status).toBe(421);
  });
});

describe("SEC-006（対応済み）：Claude を呼ぶ API の 1 分あたりの回数", () => {
  afterEach(() => resetClaudeLimits());
  const withKey = async (work: () => Promise<void>) => {
    process.env.ANTHROPIC_API_KEY = "test-key-not-used";
    try {
      await work();
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
    }
  };
  it("読解の上限を超えると 429 と Retry-After（Claude は呼ばれない）", async () => {
    resetClaudeLimits({ read: new RateWindow(0) });
    await withKey(async () => {
      const res = await post(
        "/api/case/read",
        { input: { kind: "text", text: "x".repeat(100) } },
        { "content-type": "application/json" },
      );
      expect(res.status).toBe(429);
      expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
      expect((await loose(res)).error).toContain("もう一度お試しください");
    });
  });
  it("言い換え（/api/onepager）も上限を超えると 429。rewrite: false なら数えない", async () => {
    resetClaudeLimits({ write: new RateWindow(0) });
    const theCase = (await loose(app.request("/api/case/recorded/ipa-case-1"))).case;
    const profile = (await loose(app.request("/api/examples/demo-seiko"))).profile;
    await withKey(async () => {
      const limited = await post(
        "/api/onepager",
        { case: theCase, profile, rewrite: true },
        { "content-type": "application/json" },
      );
      expect(limited.status).toBe(429);
      const template = await post(
        "/api/onepager",
        { case: theCase, profile, rewrite: false },
        { "content-type": "application/json" },
      );
      expect(template.status).toBe(200);
    });
  });
  it("記録の再生（キー無し、replay）は数えない", async () => {
    resetClaudeLimits({ read: new RateWindow(0), write: new RateWindow(0) });
    const profile = (await loose(app.request("/api/examples/demo-seiko"))).profile;
    const replay = await post(
      "/api/attacker/recon",
      { profile, replay: true },
      { "content-type": "application/json" },
    );
    expect(replay.status).toBe(200);
    expect((await loose(replay)).recorded).toBe(true);
    const recorded = await app.request("/api/case/recorded/ipa-case-1");
    expect(recorded.status).toBe(200);
  });
  it("RateWindow：窓の中で max 回まで。古い分は外れる", () => {
    let t = 0;
    const w = new RateWindow(2, 60_000, () => t);
    w.take();
    w.take();
    expect(() => w.take()).toThrow(RateLimitError);
    t = 61_000;
    expect(() => w.take()).not.toThrow();
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
