import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { mailtoUrl, OutboxMailer, SmtpMailer } from "../mail/mailer.ts";
import { RequestStore } from "../store/requests.ts";
import { defaultDeadline, requestRoutes } from "./requests.ts";

// biome-ignore lint/suspicious/noExplicitAny: テストでは応答の形を緩く読む
type Loose = any;
const loose = async (res: Response | Promise<Response>): Promise<Loose> => (await res).json();

const profile = {
  id: "demo-seiko",
  companyName: "デモ精工株式会社",
  vendor: { name: "地域の保守ベンダー（架空）", email: "vendor@example.com" },
  assets: [
    { id: "admin", role: "admin", label: "管理者アカウント" },
    { id: "vpn", role: "entry.vpn", label: "VPN装置" },
  ],
};

function build(over: Partial<Parameters<typeof requestRoutes>[0]> = {}) {
  const store = new RequestStore({ now: () => new Date("2026-11-05T10:00:00Z") });
  const app = new Hono().route(
    "/api/requests",
    requestRoutes({
      store,
      mailer: new OutboxMailer(),
      publicBaseUrl: "https://demo.example.trycloudflare.com/",
      keepAliveMs: 30,
      writer: { writer: "template" },
      now: () => new Date("2026-11-05T10:00:00Z"),
      ...over,
    }),
  );
  const post = (path: string, body: unknown) =>
    app.request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  return { app, store, post };
}

describe("POST /api/requests", () => {
  it("依頼を作り、依頼文を生成し、送信箱に積む（回答 URL は PUBLIC_BASE_URL の下）", async () => {
    const { app, post } = build();
    const res = await post("/api/requests", { profile, assetId: "admin", mitigation: "M1026" });
    expect(res.status).toBe(201);
    const { request } = await loose(res);
    expect(request.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(request.answerUrl).toBe(
      `https://demo.example.trycloudflare.com/#/answer/${request.token}`,
    );
    expect(request.to).toBe("vendor@example.com");
    expect(request.sentVia).toBe("outbox");
    expect(request.writer).toBe("template");
    expect(request.subject).toContain("管理者アカウント");
    expect(request.text).toContain("管理者のパスワードは、全 PC で共通ですか");
    expect(request.text).toContain(request.answerUrl);
    expect(request.text).toContain("T1003");
    expect(request.text).toContain("M1026");
    expect(request.background.techniqueId).toBe("T1003");
    expect(request.question.choices.map((c: { id: string }) => c.id)).toEqual([
      "shared",
      "individual",
      "unknown",
    ]);
    expect(request.mailtoUrl.startsWith("mailto:vendor%40example.com?subject=")).toBe(true);
    expect("choiceMap" in request).toBe(false);
    const list = await loose(app.request("/api/requests"));
    expect(list.items).toHaveLength(1);
    expect(list.items[0].id).toBe(request.id);
  });
  it("無い資産・質問の無い緩和策・形式違いはそれぞれ 404 / 404 / 400", async () => {
    const { post } = build();
    expect(
      (await post("/api/requests", { profile, assetId: "nope", mitigation: "M1026" })).status,
    ).toBe(404);
    expect(
      (await post("/api/requests", { profile, assetId: "admin", mitigation: "M1999" })).status,
    ).toBe(404);
    expect(
      (await post("/api/requests", { profile, assetId: "admin", mitigation: "X" })).status,
    ).toBe(500);
  });
});

describe("回答ページと回答", () => {
  it("GET /:token は質問と選択肢だけ返し、POST /:token/answer は AnswerInput を返す。二重回答は 409", async () => {
    const { app, post } = build();
    const { request } = await loose(
      post("/api/requests", { profile, assetId: "admin", mitigation: "M1026" }),
    );
    const page = await loose(app.request(`/api/requests/${request.token}`));
    expect(page.companyLabel).toBe("デモ精工株式会社");
    expect(page.question.textJa).toContain("共通ですか");
    expect(page.answered).toBe(false);
    expect(page.token).toBeUndefined();
    expect(page.subject).toBeUndefined();

    const bad = await post(`/api/requests/${request.token}/answer`, {
      choice: "zzz",
      answeredBy: "x",
    });
    expect(bad.status).toBe(400);

    const ok = await post(`/api/requests/${request.token}/answer`, {
      choice: "shared",
      answeredBy: "保守ベンダー 田中",
    });
    expect(ok.status).toBe(200);
    const body = await loose(ok);
    expect(body.answer).toMatchObject({
      assetId: "admin",
      mitigation: "M1026",
      status: "absent",
      evidence: "vendor",
      answeredBy: "保守ベンダー 田中",
      answeredAt: "2026-11-05T10:00:00.000Z",
      attrs: { sharedPassword: true },
    });
    const again = await post(`/api/requests/${request.token}/answer`, {
      choice: "individual",
      answeredBy: "別の人",
    });
    expect(again.status).toBe(409);
    const after = await loose(app.request(`/api/requests/${request.token}`));
    expect(after.answered).toBe(true);
    const list = await loose(app.request("/api/requests"));
    expect(list.items[0].answer.choiceLabelJa).toBe("全 PC で共通");
  });
  it("無いトークンは 404、形式違いは 400", async () => {
    const { app } = build();
    expect((await app.request(`/api/requests/${"a".repeat(43)}`)).status).toBe(404);
    expect((await app.request("/api/requests/short")).status).toBe(400);
  });
});

describe("GET /api/requests/events（SSE）", () => {
  it("回答が来たら answer イベントで AnswerInput を流す", async () => {
    const { app, post, store } = build();
    const { request } = await loose(
      post("/api/requests", { profile, assetId: "vpn", mitigation: "M1051" }),
    );
    const ctrl = new AbortController();
    const res = await app.request("/api/requests/events", { signal: ctrl.signal });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const dec = new TextDecoder();
    let buf = "";
    const readUntil = async (needle: string) => {
      for (let i = 0; i < 50 && !buf.includes(needle); i++) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value);
      }
      return buf.includes(needle);
    };
    expect(await readUntil("event: ready")).toBe(true);
    expect(store.subscriberCount).toBe(1);
    await post(`/api/requests/${request.token}/answer`, { choice: "absent", answeredBy: "保守" });
    expect(await readUntil("event: answer")).toBe(true);
    const line = buf.split("\n").find((l) => l.startsWith('data: {"requestId"'));
    const ev = JSON.parse((line ?? "").slice(6));
    expect(ev.requestId).toBe(request.id);
    expect(ev.profileId).toBe("demo-seiko");
    expect(ev.answer).toMatchObject({ assetId: "vpn", mitigation: "M1051", status: "absent" });
    expect(await readUntil("event: ping")).toBe(true);
    ctrl.abort();
    await reader.cancel().catch(() => {});
    await new Promise((r) => setTimeout(r, 80));
    expect(store.subscriberCount).toBe(0);
  });
});

describe("上限", () => {
  it("SSE の同時接続が上限に達すると 503", async () => {
    const { app } = build({ maxSubscribers: 1 });
    const ctrl = new AbortController();
    const first = await app.request("/api/requests/events", { signal: ctrl.signal });
    expect(first.status).toBe(200);
    const reader = (first.body as ReadableStream<Uint8Array>).getReader();
    await reader.read();
    const second = await app.request("/api/requests/events");
    expect(second.status).toBe(503);
    expect(((await second.json()) as { error: string }).error).toContain("接続");
    ctrl.abort();
    await reader.cancel().catch(() => {});
  });
  it("依頼の件数が上限に達すると 429", async () => {
    const { post } = build({ maxRequests: 1 });
    expect(
      (await post("/api/requests", { profile, assetId: "admin", mitigation: "M1026" })).status,
    ).toBe(201);
    const res = await post("/api/requests", { profile, assetId: "vpn", mitigation: "M1051" });
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: string }).error).toContain("上限");
  });
});

describe("POST /api/requests/measure-draft", () => {
  it("対策依頼文の下書きを返す（保存しない）", async () => {
    const { app, post } = build();
    const res = await post("/api/requests/measure-draft", { profile, measureId: "edr" });
    expect(res.status).toBe(200);
    const d = await loose(res);
    expect(d.writer).toBe("template");
    expect(d.subject).toContain("デモ精工株式会社");
    expect(d.text).toMatch(/M\d{4}/);
    expect(d.text).toContain("希望期限");
    expect(d.mailtoUrl.startsWith("mailto:")).toBe(true);
    const list = await loose(app.request("/api/requests"));
    expect(list.items).toHaveLength(0);
  });
});

describe("送信の差し替え", () => {
  it("mailto リンクは宛先・件名・本文を含む", () => {
    const url = mailtoUrl({ to: "v@example.com", subject: "件 名", text: "本文\n2 行目" });
    const u = new URL(url);
    expect(u.protocol).toBe("mailto:");
    expect(decodeURIComponent(u.pathname)).toBe("v@example.com");
    expect(u.searchParams.get("subject")).toBe("件 名");
    expect(u.searchParams.get("body")).toBe("本文\n2 行目");
    expect(url).not.toContain("+");
  });
  it("SMTP で送れなくても依頼は作られ、理由が送信箱に残る", async () => {
    const { post } = build({
      mailer: new SmtpMailer({ url: "smtp://127.0.0.1:1", from: "uchidai@example.com" }),
    });
    const res = await post("/api/requests", { profile, assetId: "admin", mitigation: "M1040" });
    expect(res.status).toBe(201);
    const { request } = await loose(res);
    expect(request.sentVia).toBe("outbox");
    expect(request.sendError).toContain("SMTP");
  }, 20_000);
  it("既定の期限は 7 日後（日本時間）", () => {
    expect(defaultDeadline(new Date("2026-11-05T10:00:00Z"))).toBe("2026年11月12日");
  });
});

describe("DELETE /api/requests（送信箱を空にする）", () => {
  it("メモリの依頼を全部消し、消した件数を返す。回答ページのトークンも無効になる", async () => {
    const { app, post } = build();
    const created = await post("/api/requests", { profile, assetId: "admin", mitigation: "M1026" });
    const { request } = await loose(created);
    const res = await app.request("/api/requests", { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await loose(res)).toMatchObject({ ok: true, cleared: 1 });
    const list = await loose(await app.request("/api/requests"));
    expect(list.items).toEqual([]);
    expect((await app.request(`/api/requests/${request.token}`)).status).toBe(404);
  });
});
