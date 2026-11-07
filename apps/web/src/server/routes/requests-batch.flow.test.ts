/**
 * 画面の API クライアント（requestsApi）→ サーバの経路を、外へ出る通信なしでつなぐ試験（fetch を app.request に差し替える）。
 * SBR-016：プレビューで見た本文のまま作られること、同じ選択を二重に送っても親が 1 件であること
 */
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { singleFlight } from "../../client/lib/batchSelect.ts";
import { requestsApi } from "../../client/lib/requestsApi.ts";
import type { CompanyProfile } from "../../client/lib/types.ts";
import { OutboxMailer } from "../mail/mailer.ts";
import { RequestStore } from "../store/requests.ts";
import { requestRoutes } from "./requests.ts";

const profile = {
  id: "demo-seiko",
  companyName: "デモ精工株式会社",
  vendor: { name: "保守ベンダー（架空）", email: "vendor@example.com" },
  assets: [
    { id: "admin", role: "admin", label: "管理者アカウント" },
    { id: "server", role: "server", label: "業務サーバ" },
  ],
} as unknown as CompanyProfile;
const items = [
  { assetId: "admin", mitigation: "M1026" },
  { assetId: "server", mitigation: "M1053" },
];

describe("SBR-016：画面 → サーバ", () => {
  let store: RequestStore;
  beforeEach(() => {
    store = new RequestStore();
    const app = new Hono().route(
      "/api/requests",
      requestRoutes({
        store,
        mailer: new OutboxMailer(),
        writer: { writer: "template" },
        now: () => new Date("2026-11-07T10:00:00Z"),
      }),
    );
    vi.stubGlobal("fetch", (path: string, init?: RequestInit) => app.request(path, init));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("プレビューの本文と期限のまま作られ、一覧の親の本文と一致する", async () => {
    const pv = await requestsApi.batchPreview(profile, items);
    const { batch } = await requestsApi.batchCreate(profile, items, pv, "vendor@example.com");
    expect(batch.text).toBe(pv.text);
    expect(batch.subject).toBe(pv.subject);
    const list = await requestsApi.list();
    expect(list.batches[0]?.text).toBe(pv.text);
    expect(list.items).toHaveLength(2);
  });
  it("同じ選択で 2 回押しても（実行中の singleFlight）、親は 1 件", async () => {
    const pv = await requestsApi.batchPreview(profile, items);
    const create = singleFlight(() =>
      requestsApi.batchCreate(profile, items, pv, "vendor@example.com"),
    );
    const [a, b] = await Promise.all([create(), create()]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect((await requestsApi.list()).batches).toHaveLength(1);
  });
  it("確認のあとに文面が変わった（期限が違う）ときは 409 で積まない", async () => {
    const pv = await requestsApi.batchPreview(profile, items);
    await expect(
      requestsApi.batchCreate(
        profile,
        items,
        { ...pv, deadline: "2030年1月1日" },
        "vendor@example.com",
      ),
    ).rejects.toThrow(/変わりました/);
    expect(store.size).toBe(0);
  });
  it("返信（一部の質問だけ）→ 質問ごとの取り消し → 親の削除が、画面の API でつながる", async () => {
    const pv = await requestsApi.batchPreview(profile, items);
    const { batch, items: kids } = await requestsApi.batchCreate(
      profile,
      items,
      pv,
      "vendor@example.com",
    );
    const r = await requestsApi.batchReply(batch.id, {
      answers: [
        { requestId: kids[1]?.id as string, choice: kids[1]?.question.choices[0]?.id as string },
      ],
      repliedBy: "田中",
      receivedAt: "2026-11-07T09:00:00Z",
    });
    expect(r.results).toHaveLength(1);
    expect(r.results[0]?.answer.mitigation).toBe("M1053");
    expect((await requestsApi.list()).items.filter((i) => i.answer)).toHaveLength(1);
    await requestsApi.retract(kids[1]?.id as string);
    expect((await requestsApi.list()).items.filter((i) => i.answer)).toHaveLength(0);
    await requestsApi.batchDelete(batch.id);
    expect(await requestsApi.list()).toEqual({ items: [], batches: [] });
  });
});
