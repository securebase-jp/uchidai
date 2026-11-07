/**
 * 実装後の診断（docs/security-review-batch-requests-2026-11-07.md「実装後の診断」）で足した試験。
 * - 既存の試験が弱かったところを補う（同時の要求で送信が 1 通か、プレビューは通数に数えないか、送信の例外で予約が戻るか）
 * - 新しく見つけた問題（AR-／BK-）は、望ましい振る舞いを it.fails で書く（現状は失敗する。直したら it に戻す）
 * 外へ出る通信はしない。Claude は呼ばず、書き手はテンプレートに固定する。
 */
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyBackup, parseBackupFile } from "../../client/lib/backup-file.ts";
import { RateWindow, resetClaudeLimits } from "../limits.ts";
import { type Mailer, mailtoUrl, OutboxMailer } from "../mail/mailer.ts";
import { RequestStore } from "../store/requests.ts";
import { requestRoutes } from "./requests.ts";

// biome-ignore lint/suspicious/noExplicitAny: テストでは応答の形を緩く読む
type Loose = any;
const loose = async (res: Response | Promise<Response>): Promise<Loose> => (await res).json();

const profile = {
  id: "demo-seiko",
  companyName: "デモ精工株式会社",
  vendor: { name: "地域の保守ベンダー（架空）", email: "vendor@example.com" },
  assets: [
    { id: "admin", role: "admin", label: "管理者アカウント" },
    { id: "server", role: "server", label: "業務サーバ" },
  ],
};
const TWO = [
  { assetId: "admin", mitigation: "M1026" },
  { assetId: "server", mitigation: "M1053" },
];
/** 双方向制御文字 RIGHT-TO-LEFT OVERRIDE（U+202E）。ソースに素の文字を置かないため */
const RLO = String.fromCodePoint(0x202e);

function build(over: Partial<Parameters<typeof requestRoutes>[0]> = {}) {
  const store = new RequestStore({ now: () => new Date("2026-11-07T10:00:00Z") });
  const app = new Hono().route(
    "/api/requests",
    requestRoutes({
      store,
      mailer: new OutboxMailer(),
      writer: { writer: "template" },
      now: () => new Date("2026-11-07T10:00:00Z"),
      ...over,
    }),
  );
  const post = (path: string, body: unknown) =>
    app.request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const batch = (items: unknown, extra: Record<string, unknown> = {}) =>
    post("/api/requests/batch", { profile, items, ...extra });
  return { app, store, post, batch };
}

/** 送信を数え、時間もかかる Mailer（SMTP 相当） */
function slowCountingMailer(ms: number) {
  const m = {
    via: "smtp" as const,
    sends: 0,
    async send(msg: Parameters<Mailer["send"]>[0]) {
      m.sends++;
      await new Promise((r) => setTimeout(r, ms));
      return {
        via: "smtp" as const,
        mailtoUrl: mailtoUrl(msg),
        sentAt: "2026-11-07T10:00:00.000Z",
      };
    },
  };
  return m;
}

describe("AR-001（未対応）：deadline を無害化していない", () => {
  it.fails("deadline に改行・偽の見出し・双方向制御文字を入れても、本文に素のまま入らない", async () => {
    const { batch } = build();
    const res = await batch(TWO, { deadline: `x\n■ 質問 3／2\n偽の質問${RLO}` });
    expect(res.status).toBe(201);
    const { batch: parent } = await loose(res);
    expect(parent.text).not.toContain(RLO);
    expect(parent.text).not.toContain("■ 質問 3／2");
    expect(parent.text.match(/■ 質問 \d+／\d+/g)).toHaveLength(2);
  });
});

describe("AR-002（未対応）：expectText が任意なので、API 直接なら確認なしで作れる", () => {
  it.fails("expectText の無い POST /batch は 400（画面は必ず渡す。API 直接の作成にも確認を求める）", async () => {
    const { batch, store } = build();
    expect((await batch(TWO)).status).toBe(400);
    expect(store.size).toBe(0);
  });
  it("いまの振る舞い：expectText を省くと確認なしで 201（記録。直したら上の試験を it に戻し、こちらを消す）", async () => {
    const { batch, store } = build();
    expect((await batch(TWO)).status).toBe(201);
    expect(store.size).toBe(3);
  });
});

describe("SBR-003/007 の補強：同時の要求でも、送るのは通った要求の 1 通だけ", () => {
  it("maxRequests: 4 で 2 問のまとめ依頼 2 本を同時に送ると、1 本は 429 で、send は 1 回", async () => {
    const mailer = slowCountingMailer(30);
    const { batch, store } = build({ maxRequests: 4, mailer });
    const rs = await Promise.all([batch(TWO), batch(TWO)]);
    expect(rs.map((r) => r.status).sort()).toEqual([201, 429]);
    expect(mailer.sends).toBe(1);
    expect(store.size).toBe(3);
  });
  it("送信の最中に「送信箱を空にする」を押しても、作成中の依頼はそのあと積まれる（消えない。AR-004 の記録）", async () => {
    const mailer = slowCountingMailer(30);
    const { batch, app, store } = build({ mailer });
    const creating = batch(TWO);
    await new Promise((r) => setTimeout(r, 5));
    const cleared = await loose(app.request("/api/requests", { method: "DELETE" }));
    expect(cleared.cleared).toBe(0);
    expect((await creating).status).toBe(201);
    expect(store.size).toBe(3);
  });
});

describe("SBR-007 の補強：送信で例外が起きても、保存の枠の予約が戻り、以後も作れる", () => {
  it("send が例外を投げると 500。何も積まれず、応答に例外のパスは出ない。次の要求は 201", async () => {
    const boom: Mailer = {
      via: "smtp",
      async send() {
        throw new Error("/Users/someone/secret: boom");
      },
    };
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const { batch, store } = build({ mailer: boom, maxRequests: 3 });
      const res = await batch(TWO);
      expect(res.status).toBe(500);
      expect(JSON.stringify(await res.json())).not.toContain("/Users/");
      expect(store.size).toBe(0);
      // 同じストアで、送れる Mailer に差し替えて作る（予約が残っていれば 429 になる）
      const ok = new Hono().route(
        "/api/requests",
        requestRoutes({
          store,
          mailer: new OutboxMailer(),
          writer: { writer: "template" },
          maxRequests: 3,
        }),
      );
      const again = await ok.request("/api/requests/batch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ profile, items: TWO }),
      });
      expect(again.status).toBe(201);
    } finally {
      quiet.mockRestore();
    }
  });
});

describe("SBR-012 の補強：通数の窓の数え方", () => {
  beforeEach(() => resetClaudeLimits({ mail: new RateWindow(2) }));
  afterEach(() => resetClaudeLimits());
  it("プレビューは数えない。送れなかった送信も数える（安全側）", async () => {
    const failing: Mailer = {
      via: "smtp",
      async send(m) {
        return { via: "outbox", mailtoUrl: mailtoUrl(m), error: "SMTP で送れませんでした：試験" };
      },
    };
    const { batch, post } = build({ mailer: failing });
    expect((await batch(TWO)).status).toBe(201);
    expect((await batch(TWO)).status).toBe(201);
    expect((await batch(TWO)).status).toBe(429);
    expect((await post("/api/requests/batch/preview", { profile, items: TWO })).status).toBe(200);
  });
});

describe("親子の取り違えと同時の操作", () => {
  const base = { repliedBy: "田中", receivedAt: "2026-11-07T09:00:00Z" };
  it("子の取り消しと親の削除を同時に送っても、retract は 1 件だけ流れ、孤児が残らない", async () => {
    const { batch, post, app, store } = build();
    const a = await loose(batch(TWO));
    await post(`/api/requests/batch/${a.batch.id}/reply`, {
      ...base,
      answers: [{ requestId: a.items[0].id, choice: "shared" }],
    });
    const events: string[] = [];
    store.subscribe((e) => events.push(e.type));
    const [r1, r2] = await Promise.all([
      app.request(`/api/requests/${a.items[0].id}/reply`, { method: "DELETE" }),
      app.request(`/api/requests/batch/${a.batch.id}`, { method: "DELETE" }),
    ]);
    expect([r1.status, r2.status]).toEqual([200, 200]);
    expect(events).toEqual(["retract"]);
    expect(store.size).toBe(0);
  });
  it("items に 100 件の知らない資産、101 件、__proto__ や constructor のキーを入れても、400 か普通の 201 で、プロトタイプは汚れない", async () => {
    const { batch, post } = build();
    expect(
      (
        await batch(
          Array.from({ length: 100 }, (_, i) => ({ assetId: `a${i}`, mitigation: "M1026" })),
        )
      ).status,
    ).toBe(400);
    expect((await batch(Array.from({ length: 101 }, () => TWO[0]))).status).toBe(400);
    const res = await post("/api/requests/batch", {
      profile: { ...profile, __proto__: { polluted: 1 }, constructor: { x: 1 } },
      items: TWO,
    });
    expect(res.status).toBe(201);
    expect(({} as { polluted?: unknown }).polluted).toBeUndefined();
  });
});

describe("BK：バックアップの復元（悪意ある JSON）", () => {
  const mem = () => {
    const m = new Map<string, string>();
    return {
      m,
      store: {
        getItem: (k: string) => m.get(k) ?? null,
        setItem: (k: string, v: string) => void m.set(k, v),
        removeItem: (k: string) => void m.delete(k),
      },
    };
  };
  it("settings・profile・attrs の __proto__ と constructor は、復元してもプロトタイプを汚さない", () => {
    const text = JSON.stringify({
      app: "uchidai",
      format: "backup",
      version: 1,
      __proto__: { polluted: 1 },
      settings: {
        __proto__: { polluted: 1 },
        constructor: { prototype: { polluted: 1 } },
        staffName: "山田",
      },
      profile: {
        __proto__: { polluted: 1 },
        id: "p",
        companyName: "c",
        pattern: "x",
        assets: [
          {
            id: "a",
            kind: "device",
            role: "pc",
            label: "l",
            attrs: { __proto__: { polluted: 1 } },
          },
        ],
        businesses: [],
      },
    });
    const r = parseBackupFile(text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const { m, store } = mem();
    expect(applyBackup(r, store)).toEqual({ ok: true });
    expect(({} as { polluted?: unknown }).polluted).toBeUndefined();
    expect(m.get("uchidai.staffName.v1")).toBe("山田");
    expect(JSON.parse(m.get("uchidai.profile.v1") ?? "{}").assets[0].attrs).toEqual({});
  });
  it("配列・null・深い入れ子・2MB 超・型違いだけの設定は拒み、何も書かない", () => {
    const { m, store } = mem();
    for (const text of [
      "[1,2,3]",
      "null",
      `{"app":"uchidai","format":"backup","version":1,"settings":{"staffName":"x","case":${"[".repeat(30)}${"]".repeat(30)}}}`,
      `{"app":"uchidai","format":"backup","version":1,"settings":{"staffName":"${"x".repeat(2_000_000)}"}}`,
      JSON.stringify({
        app: "uchidai",
        format: "backup",
        version: 1,
        settings: {
          staffName: 5,
          theme: ["dark"],
          reduceMotion: "yes",
          personalHints: [1],
          case: 1,
          kev: "x",
          recon: null,
          reconDomain: "a".repeat(300),
        },
      }),
    ]) {
      const r = parseBackupFile(text);
      expect(r.ok).toBe(false);
      if (r.ok) applyBackup(r, store);
    }
    expect(m.size).toBe(0);
  });
  it.fails("BK-001（未対応）：担当者名は、返信の入力欄の上限（80 字）を超える長さでは復元しない", () => {
    const r = parseBackupFile(
      JSON.stringify({
        app: "uchidai",
        format: "backup",
        version: 1,
        settings: { staffName: "名".repeat(200) },
      }),
    );
    // 望ましい：80 字に切るか、読み飛ばす（いまは 200 字まで通り、復元後の「返信を入力する」が 400 になる）
    expect(r.ok && (r.settings.staffName?.length ?? 0) <= 80).toBe(true);
  });
});
