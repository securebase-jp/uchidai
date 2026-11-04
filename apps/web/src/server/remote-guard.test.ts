import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { allowedRemotely, remoteGuard } from "./remote-guard.ts";

function build(allowAll = false) {
  const app = new Hono();
  app.use("/api/*", remoteGuard({ allowAll }));
  app.get("/api/health", (c) => c.json({ ok: true }));
  app.get("/api/sources", (c) => c.json({ categories: [] }));
  app.post("/api/sources", (c) => c.json({ ok: true }));
  app.get("/api/requests", (c) => c.json({ items: [] }));
  app.get("/api/requests/:id", (c) => c.json({ id: c.req.param("id") }));
  app.post("/api/requests/:id/reply", (c) => c.json({ ok: true }));
  app.delete("/api/requests/:id/reply", (c) => c.json({ ok: true }));
  app.post("/api/evaluate", (c) => c.json({ ok: true }));
  app.delete("/api/requests", (c) => c.json({ ok: true }));
  return app;
}

describe("remoteGuard", () => {
  it("公開 URL 経由では送信箱を空にできない", async () => {
    const app = build();
    const res = await app.request("/api/requests", {
      method: "DELETE",
      headers: { "cf-connecting-ip": "203.0.113.5" },
    });
    expect(res.status).toBe(403);
    expect((await app.request("/api/requests", { method: "DELETE" })).status).toBe(200);
  });
  it("転送ヘッダが無ければ（手元の Vite 経由）すべて通す", async () => {
    const app = build();
    expect((await app.request("/api/requests")).status).toBe(200);
    expect((await app.request("/api/evaluate", { method: "POST" })).status).toBe(200);
  });
  it("公開 URL 経由（cf-connecting-ip / x-forwarded-for）は /api/health と /api/sources だけ。送信箱と返信の入力・取り消しは手元からだけ", async () => {
    const app = build();
    const h = { "cf-connecting-ip": "203.0.113.5" };
    expect((await app.request("/api/health", { headers: h })).status).toBe(200);
    const list = await app.request("/api/requests", { headers: { "x-forwarded-for": "1.2.3.4" } });
    expect(list.status).toBe(403);
    expect(((await list.json()) as { error: string }).error).toContain("手元");
    expect((await app.request("/api/evaluate", { method: "POST", headers: h })).status).toBe(403);
    for (const [method, path] of [
      ["GET", "/api/requests/req_abc"],
      ["POST", "/api/requests/req_abc/reply"],
      ["DELETE", "/api/requests/req_abc/reply"],
      ["GET", `/api/requests/${"a".repeat(43)}`],
      ["POST", `/api/requests/${"a".repeat(43)}/answer`],
    ] as const)
      expect((await app.request(path, { method, headers: h })).status, `${method} ${path}`).toBe(
        403,
      );
    // 手元（転送ヘッダなし）からは通る
    expect((await app.request("/api/requests/req_abc/reply", { method: "POST" })).status).toBe(200);
  });
  it("出典の一覧（GET /api/sources）は公開 URL 経由でも読める。書き込みは通らない", async () => {
    const app = build();
    const h = { "cf-connecting-ip": "203.0.113.5" };
    expect((await app.request("/api/sources", { headers: h })).status).toBe(200);
    expect((await app.request("/api/sources", { method: "POST", headers: h })).status).toBe(403);
    expect(allowedRemotely("GET", "/api/sources")).toBe(true);
    expect(allowedRemotely("GET", "/api/sources/x")).toBe(false);
  });
  it("UCHIDAI_ALLOW_REMOTE_API 相当で全面許可にできる", async () => {
    const app = build(true);
    const h = { "x-forwarded-for": "1.2.3.4" };
    expect((await app.request("/api/requests", { headers: h })).status).toBe(200);
  });
  it("allowedRemotely は health と sources の GET だけ（OPTIONS は通す）", () => {
    expect(allowedRemotely("GET", "/api/health")).toBe(true);
    expect(allowedRemotely("GET", "/api/sources")).toBe(true);
    expect(allowedRemotely("OPTIONS", "/api/requests/req_abc/reply")).toBe(true);
    expect(allowedRemotely("GET", "/api/requests/req_abc")).toBe(false);
    expect(allowedRemotely("POST", "/api/requests/req_abc/reply")).toBe(false);
    expect(allowedRemotely("DELETE", "/api/requests/req_abc/reply")).toBe(false);
    expect(allowedRemotely("POST", `/api/requests/${"a".repeat(43)}/answer`)).toBe(false);
    expect(allowedRemotely("GET", "/api/requests/events")).toBe(false);
    expect(allowedRemotely("POST", "/api/requests/measure-draft")).toBe(false);
    expect(allowedRemotely("GET", "/api/knowledge")).toBe(false);
  });
});
