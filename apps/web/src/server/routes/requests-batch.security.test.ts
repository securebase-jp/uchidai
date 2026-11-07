/**
 * セキュリティ診断（docs/security-review-batch-requests-2026-11-07.md）の試験。
 * - BR：診断で見つけた現在の実装の問題。まとめ依頼の実装で直し、期待値を反転して固定している（BR-003 は「本文をコピー」で対応）
 * - SBR：まとめ依頼（POST /api/requests/batch）が満たす要件。要件の ID を試験の名前に残している
 * - 問題なかったもの：まとめ依頼にも効く約束を固定する
 * 外へ出る通信はしない。Claude は呼ばず、書き手はテンプレートに固定する。
 */
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadKnowledge } from "@uchidai/engine";
import {
  fillNames,
  numberedChoices,
  REPLY_EXAMPLE_RE,
  sanitizeName,
  vendorRequestTemplate,
} from "@uchidai/llm";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RateWindow, resetClaudeLimits } from "../limits.ts";
import { type Mailer, mailtoUrl, OutboxMailer } from "../mail/mailer.ts";
import { backgroundFor } from "../requests/questions.ts";
import { RequestStore } from "../store/requests.ts";
import { autoExpect } from "./batch-test-helpers.ts";
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
    { id: "vpn", role: "entry.vpn", label: "VPN装置" },
    { id: "server", role: "server", label: "業務サーバ" },
  ],
};

function build(over: Partial<Parameters<typeof requestRoutes>[0]> = {}) {
  const store = new RequestStore({ now: () => new Date("2026-11-07T10:00:00Z") });
  const app = autoExpect(new Hono()).route(
    "/api/requests",
    requestRoutes({
      store,
      mailer: new OutboxMailer(),
      keepAliveMs: 30,
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
  return { app, store, post };
}

/** 送信に時間がかかる Mailer（同時の要求の割り込みを再現する） */
function slowMailer(ms: number): Mailer {
  return {
    via: "outbox",
    async send(msg) {
      await new Promise((r) => setTimeout(r, ms));
      return { via: "outbox", mailtoUrl: mailtoUrl(msg) };
    },
  };
}

describe("BR-001（対応済み）：保存の上限を、同時の要求がすり抜けない", () => {
  it("maxRequests: 1 で、送信を待つ間に届いた要求は 1 件だけ 201、他は 429", async () => {
    const { post, store } = build({ maxRequests: 1, mailer: slowMailer(30) });
    const results = await Promise.all([
      post("/api/requests", { profile, assetId: "admin", mitigation: "M1026" }),
      post("/api/requests", { profile, assetId: "vpn", mitigation: "M1051" }),
      post("/api/requests", { profile, assetId: "vpn", mitigation: "M1032" }),
    ]);
    expect(results.map((r) => r.status)).toEqual([201, 429, 429]);
    expect(store.size).toBe(1);
  });
});

describe("BR-002（対応済み）：fillNames の置換は連鎖せず、名前の {{ }} は無害化される", () => {
  it("会社名の {{asset}}、ベンダー名の {{staff}}、資産名の {{company}} は、別の名前に化けず全角にして残る", () => {
    const out = fillNames("{{company}}／{{vendor}}／{{asset}}／{{staff}}", {
      companyLabel: "{{asset}}社",
      vendorLabel: "{{staff}}",
      assetLabel: "{{company}}",
    });
    expect(out).toBe("｛｛asset｝｝社／｛｛staff｝｝／｛｛company｝｝／情報システム担当");
  });
});

describe("BR-003（対応：まとめ依頼は「本文をコピー」を主にする）：mailto: の長さ", () => {
  it("1 問でも約 3,800 字。10 問相当の本文では 1 万字を超える（切れるメールソフトがある）", async () => {
    const { post } = build();
    const { request } = await loose(
      post("/api/requests", { profile, assetId: "admin", mitigation: "M1026" }),
    );
    expect(request.mailtoUrl.length).toBeGreaterThan(2_000);
    const t = vendorRequestTemplate({
      companyLabel: profile.companyName,
      assetLabel: "管理者アカウント",
      assetRoleLabel: "管理者アカウント",
      question: "管理者のパスワードは、全 PC で共通ですか",
      choices: ["全 PC で共通", "PC ごとに個別", "分からない"],
      mitigationId: "M1026",
      mitigationLabel: "特権アカウント管理",
      techniqueId: "T1003",
      techniqueLabel: "OS 認証情報のダンプ",
      deadline: "2026年11月14日",
    });
    const block = t.body.split("■ ご質問")[1]?.split("■ 背景")[0] ?? "";
    expect(block.length).toBeGreaterThan(100);
    const ten = t.body + block.repeat(9);
    const url = mailtoUrl({ to: "vendor@example.com", subject: t.subject, text: ten });
    expect(url.length).toBeGreaterThan(10_000);
  });
});

/** 件名・本文に残ってはいけない文字（改行は本文では許す）。ソースに素の文字を置かないため、コードポイントから作る */
const UNSAFE = new RegExp(
  `[\\u0000-\\u0009\\u000b-\\u001f\\u007f${String.fromCodePoint(0x2028)}${String.fromCodePoint(0x2029)}${String.fromCodePoint(0x202a)}-${String.fromCodePoint(0x202e)}${String.fromCodePoint(0x2066)}-${String.fromCodePoint(0x2069)}]`,
);

/** 双方向制御文字 RIGHT-TO-LEFT OVERRIDE（U+202E）。ソースに素の文字を置かないため */
const RLO = String.fromCodePoint(0x202e);

describe("BR-004（対応済み）：カルテ由来の制御文字は件名と本文に入らない", () => {
  it("会社名の CR LF、資産名の NUL と双方向制御文字（U+202E）は取り除かれる（1 項目 1 依頼）", async () => {
    const { post } = build();
    const bad = {
      ...profile,
      companyName: "A\r\nBcc: x@example.com",
      assets: [{ id: "admin", role: "admin", label: `管理者${RLO}\u0000アカウント` }],
    };
    const res = await post("/api/requests", {
      profile: bad,
      assetId: "admin",
      mitigation: "M1026",
    });
    expect(res.status).toBe(201);
    const { request } = await loose(res);
    expect(request.subject).not.toMatch(/[\r\n]/);
    expect(request.subject).not.toContain(RLO);
    expect(request.subject).not.toContain("\u0000");
    expect(request.text).not.toContain(RLO);
    expect(request.assetLabel).toBe("管理者アカウント");
    // mailto: の中では符号化される（問題なかったもの）
    expect(request.mailtoUrl).not.toMatch(/[\r\n]/);
    expect(request.mailtoUrl).not.toContain("\u0000");
    expect(request.mailtoUrl).not.toContain(RLO);
  });
});

describe("BR-005（対応済み）：保存ファイルの answer を読み込み時に検証する", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });
  it("依頼と違う資産・緩和策、evidence: external の answer は読み込みで落ち、依頼は残って回答できる", () => {
    dir = mkdtempSync(join(tmpdir(), "uchidai-br005-"));
    const file = join(dir, "requests.json");
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        items: [
          {
            id: "req_tampered",
            profileId: "demo-seiko",
            companyLabel: "c",
            assetId: "admin",
            assetLabel: "管理者アカウント",
            mitigation: "M1026",
            createdAt: "2026-11-01T00:00:00.000Z",
            question: { textJa: "q", choices: [{ id: "shared", labelJa: "全 PC で共通" }] },
            choiceMap: [{ id: "shared", labelJa: "全 PC で共通", status: "absent" }],
            subject: "s",
            text: "t",
            mailtoUrl: "mailto:",
            sentVia: "outbox",
            writer: "template",
            answer: {
              choice: "zzz",
              choiceLabelJa: "x",
              input: {
                assetId: "OTHER",
                mitigation: "M9999",
                status: "absent",
                evidence: "external",
                answeredBy: "x",
              },
            },
          },
        ],
      }),
    );
    const warn = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const store = new RequestStore({ file });
    warn.mockRestore();
    const it = store.byId("req_tampered");
    expect(it).toBeDefined();
    expect(it?.answer).toBeUndefined();
    expect(
      store.recordReply("req_tampered", {
        choice: "shared",
        repliedBy: "x",
        receivedAt: "2026-11-01T00:00:00Z",
      })?.answer,
    ).toMatchObject({ assetId: "admin", mitigation: "M1026", evidence: "vendor" });
  });
});

describe("BR-006（対応済み）：SMTP の送信には 1 分あたりの上限がある", () => {
  beforeEach(() => resetClaudeLimits({ mail: new RateWindow(10) }));
  afterEach(() => resetClaudeLimits());
  it("send を数える Mailer で 25 回続けて作ると、10 回で 429 になる", async () => {
    let sends = 0;
    const counting: Mailer = {
      via: "smtp",
      async send(msg) {
        sends++;
        return { via: "smtp", mailtoUrl: mailtoUrl(msg), sentAt: "2026-11-07T10:00:00.000Z" };
      },
    };
    const { post } = build({ mailer: counting });
    const statuses: number[] = [];
    for (let i = 0; i < 25; i++)
      statuses.push(
        (await post("/api/requests", { profile, assetId: "admin", mitigation: "M1026" })).status,
      );
    expect(statuses.filter((s) => s === 201)).toHaveLength(10);
    expect(statuses.slice(10).every((s) => s === 429)).toBe(true);
    expect(sends).toBe(10);
  });
});

describe("問題なかったもの（まとめ依頼にも効く約束）", () => {
  it("本文の番号と送信箱の選択肢は同じ並び（numberedChoices → question.choices）。返信の例に具体的な番号は無い", async () => {
    const { post } = build();
    for (const [assetId, mitigation] of [
      ["admin", "M1026"],
      ["server", "M1053"],
      ["vpn", "M1032"],
    ] as const) {
      const { request } = await loose(post("/api/requests", { profile, assetId, mitigation }));
      const labels = request.question.choices.map((c: { labelJa: string }) => c.labelJa);
      for (const c of numberedChoices(labels))
        expect(request.text).toContain(`\n${c.number}. ${c.label}\n`);
      expect(REPLY_EXAMPLE_RE.test(request.text)).toBe(false);
      expect(request.text).toContain("例：（番号）　（お名前）");
    }
  });
  it("mailto: は 10 問相当の長い本文でも、改行と & を素のまま含まず、宛先の後ろのクエリは 1 つ", () => {
    const text = `■ 質問 1／10\n${"選択肢&その他\r\n".repeat(400)}`;
    const url = mailtoUrl({ to: "vendor@example.com", subject: "件名", text });
    expect(url).not.toMatch(/[\r\n]/);
    expect(url).not.toContain("&cc=");
    expect(url.split("?")).toHaveLength(2);
    expect(new URL(url).searchParams.get("body")).toBe(text);
  });
  it("別のカルテの依頼にも返信は 200 で通る（認証の無い手元のサーバ。画面側が profileId で判定への反映を絞る）", async () => {
    const { post } = build();
    const { request } = await loose(
      post("/api/requests", { profile, assetId: "admin", mitigation: "M1026" }),
    );
    const res = await post(`/api/requests/${request.id}/reply`, {
      choice: "shared",
      repliedBy: "x",
      receivedAt: "2026-11-07T09:00:00Z",
    });
    expect(res.status).toBe(200);
    expect((await loose(res)).request.profileId).toBe("demo-seiko");
  });
  it("作成の経路はテンプレートの書き手でも choiceMap を応答に出さない。回答は choiceMap の id だけ", async () => {
    const { post } = build();
    const { request } = await loose(
      post("/api/requests", { profile, assetId: "server", mitigation: "M1053" }),
    );
    expect("choiceMap" in request).toBe(false);
    expect(
      (
        await post(`/api/requests/${request.id}/reply`, {
          choice: "1",
          repliedBy: "x",
          receivedAt: "2026-11-07T09:00:00Z",
        })
      ).status,
    ).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// SBR：まとめ依頼（POST /api/requests/batch）の要件
// ---------------------------------------------------------------------------
const profile4 = {
  id: "demo-seiko",
  companyName: "デモ精工株式会社",
  vendor: { name: "地域の保守ベンダー（架空）", email: "vendor@example.com" },
  assets: [
    { id: "admin", role: "admin", label: "管理者アカウント" },
    { id: "vpn", role: "entry.vpn", label: "VPN装置" },
    { id: "server", role: "server", label: "業務サーバ" },
    { id: "pc", role: "endpoint", label: "社員PC" },
  ],
};
/** 質問表にある、役割の違う 10 項目 */
const TEN = [
  { assetId: "admin", mitigation: "M1026" },
  { assetId: "admin", mitigation: "M1040" },
  { assetId: "admin", mitigation: "M1051" },
  { assetId: "admin", mitigation: "M1032" },
  { assetId: "admin", mitigation: "M1042" },
  { assetId: "server", mitigation: "M1035" },
  { assetId: "server", mitigation: "M1030" },
  { assetId: "server", mitigation: "M1057" },
  { assetId: "server", mitigation: "M1031" },
  { assetId: "server", mitigation: "M1053" },
];
const ELEVENTH = { assetId: "vpn", mitigation: "M1022" };

/** 送信を数える Mailer（SMTP 相当） */
function countingMailer(over: Partial<Mailer> = {}): Mailer & { sends: number } {
  const m = {
    via: "smtp" as const,
    sends: 0,
    async send(msg: Parameters<Mailer["send"]>[0]) {
      m.sends++;
      return {
        via: "smtp" as const,
        mailtoUrl: mailtoUrl(msg),
        sentAt: "2026-11-07T10:00:00.000Z",
      };
    },
    ...over,
  };
  return m;
}

/** app.ts と同じ経路を使わず、この経路だけで返す応答の形を確かめる */
function buildBatch(over: Partial<Parameters<typeof requestRoutes>[0]> = {}) {
  const b = build(over);
  const batch = (items: unknown, extra: Record<string, unknown> = {}) =>
    b.post("/api/requests/batch", { profile: profile4, items, ...extra });
  const list = async () => loose(b.app.request("/api/requests"));
  const reply = (id: string, body: unknown) => b.post(`/api/requests/batch/${id}/reply`, body);
  const when = "2026-11-07T09:00:00Z";
  return { ...b, batch, list, reply, when };
}

describe("SBR-001/002/003：親子の整合、宛先、送信は 1 通", () => {
  it("SBR-001：親と子は同じ profileId・to・companyLabel。GET / は子を items、親を batches で返す", async () => {
    const { batch, list } = buildBatch();
    const res = await batch([TEN[0], TEN[5]]);
    expect(res.status).toBe(201);
    const { batch: parent, items } = await loose(res);
    expect(parent.kind).toBe("batch");
    expect(parent.childIds).toEqual(items.map((i: Loose) => i.id));
    for (const c of items) {
      expect(c.parentId).toBe(parent.id);
      expect(c.profileId).toBe(parent.profileId);
      expect(c.to).toBe(parent.to);
      expect(c.companyLabel).toBe(parent.companyLabel);
      expect("choiceMap" in c).toBe(false);
    }
    expect(parent.to).toBe("vendor@example.com");
    const l = await list();
    expect(l.batches).toHaveLength(1);
    expect(l.items).toHaveLength(2);
  });
  it("SBR-001：カルテにない資産を含む items は 404 で、親も子も保存されない", async () => {
    const { batch, list, store } = buildBatch();
    const res = await batch([
      { assetId: "admin", mitigation: "M1026" },
      { assetId: "nope", mitigation: "M1040" },
    ]);
    expect(res.status).toBe(404);
    expect(store.size).toBe(0);
    expect(await list()).toEqual({ items: [], batches: [] });
  });
  it("SBR-001：質問表にない緩和策は 404", async () => {
    const { batch, store } = buildBatch();
    expect((await batch([{ assetId: "admin", mitigation: "M9999" }])).status).toBe(404);
    expect(store.size).toBe(0);
  });
  it("SBR-002：宛先は 1 件のメールアドレスの形だけ。複数・改行・アドレスでない文字列は 400 で send を呼ばない", async () => {
    const mailer = countingMailer();
    const { batch, store } = buildBatch({ mailer });
    for (const to of ["a@example.com, b@example.com", "a@example.com\nBcc: b@example.com", "x"]) {
      expect((await batch([TEN[0]], { to })).status).toBe(400);
    }
    expect(mailer.sends).toBe(0);
    expect(store.size).toBe(0);
  });
  it("SBR-002：to もカルテのメールも無ければ 400。カルテのメールがあれば to 無しで作れる", async () => {
    const mailer = countingMailer();
    const { post } = buildBatch({ mailer });
    const noVendorMail = { ...profile4, vendor: { name: "ベンダー" } };
    const res = await post("/api/requests/batch", { profile: noVendorMail, items: [TEN[0]] });
    expect(res.status).toBe(400);
    expect(mailer.sends).toBe(0);
    const ok = await post("/api/requests/batch", {
      profile: noVendorMail,
      items: [TEN[0]],
      to: "z@example.com",
    });
    expect(ok.status).toBe(201);
    expect((await loose(ok)).batch.to).toBe("z@example.com");
  });
  it("SBR-002：プレビューは宛先が無くても作れる（画面で入力できるように）。宛先の形が悪ければ 400", async () => {
    const { post } = buildBatch();
    const noTo = { ...profile4, vendor: undefined };
    const res = await post("/api/requests/batch/preview", { profile: noTo, items: [TEN[0]] });
    expect(res.status).toBe(200);
    expect((await loose(res)).to).toBeUndefined();
    expect(
      (await post("/api/requests/batch/preview", { profile: profile4, items: [TEN[0]], to: "x y" }))
        .status,
    ).toBe(400);
  });
  it("SBR-003：10 問でも mailer.send は 1 回。子は send しない", async () => {
    const mailer = countingMailer();
    const { batch, list } = buildBatch({ mailer });
    const res = await batch(TEN);
    expect(res.status).toBe(201);
    expect(mailer.sends).toBe(1);
    const { batch: parent } = await loose(res);
    expect(parent.sentVia).toBe("smtp");
    expect(parent.sentAt).toBe("2026-11-07T10:00:00.000Z");
    expect((await list()).items).toHaveLength(10);
  });
  it("SBR-003：SMTP が失敗しても親子は作られ、sendError が親と子に残る", async () => {
    const failing = countingMailer({
      async send(msg) {
        return {
          via: "outbox",
          mailtoUrl: mailtoUrl(msg),
          error: "SMTP で送れませんでした：接続できません",
        };
      },
    });
    const { batch, list } = buildBatch({ mailer: failing });
    const res = await batch(TEN.slice(0, 3));
    expect(res.status).toBe(201);
    const { batch: parent, items } = await loose(res);
    expect(parent.sendError).toMatch(/送れませんでした/);
    expect(parent.sentVia).toBe("outbox");
    for (const c of items) expect(c.sendError).toBe(parent.sendError);
    expect((await list()).batches).toHaveLength(1);
  });
});

describe("SBR-004/005：返信は原子的、二重回答は 409", () => {
  async function three() {
    const ctx = buildBatch();
    const res = await ctx.batch([TEN[0], TEN[9], TEN[3]]);
    const { batch, items } = await loose(res);
    const events: { type: string; event: Loose }[] = [];
    ctx.store.subscribe((e) => events.push(e));
    return { ...ctx, batch, items, events };
  }
  const base = { repliedBy: "田中", receivedAt: "2026-11-07T09:00:00Z" };

  it("SBR-004：2 問目の choice が未知なら 400。3 問とも answer が無く、SSE は 0 件、保存もしない", async () => {
    const { reply, batch, items, events, list, store } = await three();
    const persist = vi.spyOn(store as unknown as { persist(): void }, "persist");
    const res = await reply(batch.id, {
      ...base,
      answers: [
        { requestId: items[0].id, choice: "shared" },
        { requestId: items[1].id, choice: "zzz" },
        { requestId: items[2].id, choice: "all" },
      ],
    });
    expect(res.status).toBe(400);
    expect((await list()).items.every((i: Loose) => !i.answer)).toBe(true);
    expect(events).toHaveLength(0);
    expect(persist).not.toHaveBeenCalled();
  });
  it("SBR-004：読めない日時・未来の日時でも何も変わらない", async () => {
    const { reply, batch, items, events, list } = await three();
    for (const receivedAt of ["昨日", "2999-01-01T00:00:00Z"]) {
      const res = await reply(batch.id, {
        repliedBy: "田中",
        receivedAt,
        answers: [{ requestId: items[0].id, choice: "shared" }],
      });
      expect(res.status).toBe(400);
    }
    expect((await list()).items.some((i: Loose) => i.answer)).toBe(false);
    expect(events).toHaveLength(0);
  });
  it("SBR-004：成功すれば 3 件の answer イベントが流れ、保存は 1 回。判定の根拠はベンダー回答", async () => {
    const { reply, batch, items, events, list, store } = await three();
    const persist = vi.spyOn(store as unknown as { persist(): void }, "persist");
    const choices = ["shared", "isolated_tested", "all"];
    const res = await reply(batch.id, {
      ...base,
      enteredBy: "情シス",
      answers: items.map((it: Loose, i: number) => ({ requestId: it.id, choice: choices[i] })),
    });
    expect(res.status).toBe(200);
    const body = await loose(res);
    expect(body.results).toHaveLength(3);
    expect(body.results[0].answer).toMatchObject({
      assetId: "admin",
      mitigation: "M1026",
      status: "absent",
      evidence: "vendor",
      answeredBy: "田中",
    });
    expect(events.filter((e) => e.type === "answer")).toHaveLength(3);
    expect(persist).toHaveBeenCalledTimes(1);
    const l = await list();
    expect(l.items.every((i: Loose) => i.answer && i.enteredBy === "情シス")).toBe(true);
  });
  it("SBR-004：一部の質問だけ答えられる（未入力の質問は残る）", async () => {
    const { reply, batch, items, list } = await three();
    const res = await reply(batch.id, {
      ...base,
      answers: [{ requestId: items[1].id, choice: "absent" }],
    });
    expect(res.status).toBe(200);
    const l = await list();
    expect(l.items.map((i: Loose) => Boolean(i.answer))).toEqual(
      l.items.map((i: Loose) => i.id === items[1].id),
    );
  });
  it("SBR-005：回答済みの子を含む配列は 409 で、未回答の子にも反映しない", async () => {
    const { reply, batch, items, list, events } = await three();
    expect(
      (await reply(batch.id, { ...base, answers: [{ requestId: items[0].id, choice: "shared" }] }))
        .status,
    ).toBe(200);
    events.length = 0;
    const res = await reply(batch.id, {
      ...base,
      answers: [
        { requestId: items[0].id, choice: "individual" },
        { requestId: items[2].id, choice: "all" },
      ],
    });
    expect(res.status).toBe(409);
    const l = await list();
    expect(l.items.find((i: Loose) => i.id === items[2].id).answer).toBeUndefined();
    expect(l.items.find((i: Loose) => i.id === items[0].id).answer.choice).toBe("shared");
    expect(events).toHaveLength(0);
  });
  it("親の子でない id・同じ質問の重複・他のまとめ依頼の子は 400。親でない id は 404", async () => {
    const { reply, batch, items, post } = await three();
    const other = await loose(
      await post("/api/requests/batch", { profile: profile4, items: [TEN[5]] }),
    );
    for (const answers of [
      [{ requestId: "req_nope", choice: "shared" }],
      [{ requestId: other.items[0].id, choice: "shared" }],
      [
        { requestId: items[0].id, choice: "shared" },
        { requestId: items[0].id, choice: "individual" },
      ],
    ]) {
      expect((await reply(batch.id, { ...base, answers })).status).toBe(400);
    }
    expect(
      (
        await reply(items[0].id, {
          ...base,
          answers: [{ requestId: items[0].id, choice: "shared" }],
        })
      ).status,
    ).toBe(404);
    expect(
      (await reply("nope", { ...base, answers: [{ requestId: items[0].id, choice: "shared" }] }))
        .status,
    ).toBe(404);
  });
  it("子の id への単独の返信（POST /:id/reply）は 409 で、まとめの返信へ誘導する", async () => {
    const { post, items } = await three();
    const res = await post(`/api/requests/${items[0].id}/reply`, {
      choice: "shared",
      repliedBy: "x",
      receivedAt: "2026-11-07T09:00:00Z",
    });
    expect(res.status).toBe(409);
  });
});

describe("SBR-006：取り消しと削除。孤児を作らない", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });
  const base = { repliedBy: "田中", receivedAt: "2026-11-07T09:00:00Z" };

  it("子ごとの取り消し（DELETE /:id/reply）は既存の retract。親は残り、その子だけ回答待ちに戻る", async () => {
    const { batch, reply, store, app } = buildBatch();
    const { batch: parent, items } = await loose(await batch([TEN[0], TEN[5]]));
    await reply(parent.id, {
      ...base,
      answers: items.map((i: Loose) => ({ requestId: i.id, choice: "unknown" })),
    });
    const events: string[] = [];
    store.subscribe((e) => events.push(e.type));
    const res = await app.request(`/api/requests/${items[0].id}/reply`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(events).toEqual(["retract"]);
    expect(store.byId(items[0].id)?.answer).toBeUndefined();
    expect(store.byId(items[1].id)?.answer).toBeDefined();
    expect(store.batchById(parent.id)).toBeDefined();
  });
  it("親の削除は、回答済みの子を取り消して（retract イベント）、子をすべて消す", async () => {
    const { batch, reply, store, app, list } = buildBatch();
    const { batch: parent, items } = await loose(await batch([TEN[0], TEN[5], TEN[9]]));
    await reply(parent.id, { ...base, answers: [{ requestId: items[0].id, choice: "shared" }] });
    const events: { type: string; event: Loose }[] = [];
    store.subscribe((e) => events.push(e));
    const res = await app.request(`/api/requests/batch/${parent.id}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "retract",
      event: { requestId: items[0].id, assetId: "admin", mitigation: "M1026" },
    });
    expect(await list()).toEqual({ items: [], batches: [] });
    expect(store.size).toBe(0);
    expect(
      (await app.request(`/api/requests/batch/${parent.id}`, { method: "DELETE" })).status,
    ).toBe(404);
  });
  it("DELETE /?profileId= は、そのカルテの親と子を一緒に消す。他のカルテの親子は残る。保存を読み直しても孤児が無い", async () => {
    dir = mkdtempSync(join(tmpdir(), "uchidai-sbr006-"));
    const file = join(dir, "requests.json");
    const store = new RequestStore({ file, now: () => new Date("2026-11-07T10:00:00Z") });
    const app = autoExpect(new Hono()).route(
      "/api/requests",
      requestRoutes({
        store,
        mailer: new OutboxMailer(),
        writer: { writer: "template" },
        now: () => new Date("2026-11-07T10:00:00Z"),
      }),
    );
    const post = (body: unknown) =>
      app.request("/api/requests/batch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    await post({ profile: profile4, items: [TEN[0], TEN[5]] });
    await post({ profile: { ...profile4, id: "other" }, items: [TEN[0]] });
    const res = await loose(
      app.request("/api/requests?profileId=demo-seiko", { method: "DELETE" }),
    );
    expect(res.cleared).toBe(3); // 親 1 ＋ 子 2
    const again = new RequestStore({ file });
    expect(again.size).toBe(2);
    expect(again.listBatches().map((b) => b.profileId)).toEqual(["other"]);
    expect(again.list().every((c) => c.parentId === again.listBatches()[0]?.id)).toBe(true);
    expect(
      await loose(app.request("/api/requests?profileId=", { method: "DELETE" })),
    ).toMatchObject({ cleared: 0 });
  });
});

describe("SBR-007：件数と保存の上限", () => {
  it("同じ項目を 11 回並べても、重複を除いて 1 件のまとめとして作る", async () => {
    const { batch, list } = buildBatch();
    const res = await batch(Array.from({ length: 11 }, () => TEN[0]));
    expect(res.status).toBe(201);
    expect((await list()).items).toHaveLength(1);
  });
  it("重複を除いて 11 件は 400、10 件は 201。0 件も 400", async () => {
    const { batch, store } = buildBatch();
    expect((await batch([...TEN, ELEVENTH])).status).toBe(400);
    expect((await batch([])).status).toBe(400);
    expect(store.size).toBe(0);
    expect((await batch([...TEN, ...TEN])).status).toBe(201);
    expect(store.size).toBe(11);
  });
  it("maxRequests: 5 で 10 問は 429 で何も保存せず、送信もしない", async () => {
    const mailer = countingMailer();
    const { batch, store } = buildBatch({ maxRequests: 5, mailer });
    expect((await batch(TEN)).status).toBe(429);
    expect(store.size).toBe(0);
    expect(mailer.sends).toBe(0);
  });
  it("maxRequests: 12 で 10 問の要求 2 本を同時に送ると、1 本は 429 で store.size <= 12", async () => {
    const { batch, store } = buildBatch({ maxRequests: 12, mailer: slowMailer(30) });
    const rs = await Promise.all([batch(TEN), batch(TEN)]);
    expect(rs.map((r) => r.status).sort()).toEqual([201, 429]);
    expect(store.size).toBeLessThanOrEqual(12);
    expect(store.size).toBe(11);
  });
  it("1 項目 1 依頼と まとめ依頼を同時に送っても、合計が上限を超えない", async () => {
    const { batch, post, store } = buildBatch({ maxRequests: 3, mailer: slowMailer(20) });
    const rs = await Promise.all([
      batch([TEN[0], TEN[5]]), // 3 件
      post("/api/requests", { profile: profile4, assetId: "admin", mitigation: "M1026" }),
    ]);
    // どちらが先に枠を取るかは決まっていない（まとめは先にプレビューを取る）。片方だけが通り、合計は上限を超えない
    expect(rs.map((r) => r.status).sort()).toEqual([201, 429]);
    expect(store.size).toBeLessThanOrEqual(3);
  });
  it("ストアの add も、上限を超えるなら積まない（backstop）", () => {
    const store = new RequestStore();
    expect(() =>
      store.addBatch({ id: "b", kind: "batch" } as never, [{ id: "c" }, { id: "d" }] as never, 2),
    ).toThrow(/上限/);
    expect(store.size).toBe(0);
  });
});

describe("SBR-008/009/011：本文の番号、返信の例、載せない情報", () => {
  const two = [
    { assetId: "admin", mitigation: "M1026" },
    { assetId: "server", mitigation: "M1053" },
  ];
  it("SBR-008：質問ごとに 1 から振り直し、本文・question.choices・choiceMap が同じ並び", async () => {
    const { batch, post } = buildBatch();
    const { batch: parent, items } = await loose(await batch(two));
    expect(parent.text).toContain(
      "■ 質問 1／2\n対象：管理者アカウント\n管理者のパスワードは、全 PC で共通ですか\n1. 全 PC で共通\n2. PC ごとに個別\n3. 分からない\n",
    );
    expect(parent.text).toContain("■ 質問 2／2\n対象：業務サーバ\n");
    for (const c of items) {
      const labels = c.question.choices.map((x: { labelJa: string }) => x.labelJa);
      for (const n of numberedChoices(labels))
        expect(parent.text).toContain(`\n${n.number}. ${n.label}\n`);
    }
    expect(items[1].question.choices).toHaveLength(5);
    // choiceMap は question.choices と同じ id の並び：番号 i の選択肢の id で返信すると、i 番目の文言が回答になる
    const reply = await loose(
      await post(`/api/requests/batch/${parent.id}/reply`, {
        repliedBy: "田中",
        receivedAt: "2026-11-07T09:00:00Z",
        answers: items.map((c: Loose) => ({ requestId: c.id, choice: c.question.choices[1].id })),
      }),
    );
    expect(reply.results.map((r: Loose) => r.choiceLabelJa)).toEqual([
      items[0].question.choices[1].labelJa,
      items[1].question.choices[1].labelJa,
    ]);
  });
  it("SBR-009：返信の例に具体的な番号を入れない。「■ 質問 k／N」が順に 1 回ずつ", async () => {
    const { batch } = buildBatch();
    const { batch: parent } = await loose(await batch(TEN));
    expect(REPLY_EXAMPLE_RE.test(parent.text)).toBe(false);
    let from = 0;
    for (let k = 1; k <= 10; k++) {
      const h = `■ 質問 ${k}／10`;
      const at = parent.text.indexOf(h, from);
      expect(at).toBeGreaterThanOrEqual(from);
      expect(parent.text.indexOf(h, at + 1)).toBe(-1);
      from = at;
    }
    expect(parent.text).toContain("10 点だけ教えてください");
    expect(parent.text).toContain("ご回答の期限：");
  });
  it("SBR-011：攻撃の手法 ID（T で始まる ID）と判定の材料を載せない", async () => {
    const { batch } = buildBatch();
    const { batch: parent } = await loose(await batch(TEN));
    expect(parent.subject + parent.text).not.toMatch(/\bT\d{4}(\.\d{3})?\b/);
    expect(parent.text).not.toContain("MITRE");
    expect(parent.text).not.toContain("判定の材料");
    const k = loadKnowledge();
    for (const i of TEN) {
      const role = profile4.assets.find((a) => a.id === i.assetId)?.role;
      const bg = backgroundFor(i.mitigation, role, k);
      if (bg.materialsJa) expect(parent.text).not.toContain(bg.materialsJa);
      expect(parent.text).not.toContain(i.mitigation);
    }
  });
});

describe("SBR-010：mailto: は補助", () => {
  it("10 問の mailtoUrl は符号化の約束を守る（改行・& が素で入らない）。長さは 1 万字を超えるので、主な送り方は本文のコピー", async () => {
    const { batch } = buildBatch();
    const { batch: parent } = await loose(await batch(TEN));
    expect(parent.mailtoUrl).not.toMatch(/[\r\n]/);
    expect(parent.mailtoUrl.split("?")).toHaveLength(2);
    expect(new URL(parent.mailtoUrl).searchParams.get("body")).toBe(parent.text);
    expect(parent.mailtoUrl.length).toBeGreaterThan(8_000); // メールソフトによっては切れる長さ。画面は「本文をコピー」を主にする
  });
});

describe("SBR-012：メール送信の上限", () => {
  beforeEach(() => resetClaudeLimits({ mail: new RateWindow(10) }));
  afterEach(() => resetClaudeLimits());
  it("SMTP 相当の Mailer では、11 回目の POST /batch が 429 と Retry-After。送信は 10 回", async () => {
    const mailer = countingMailer();
    const { batch } = buildBatch({ mailer });
    for (let i = 0; i < 10; i++) expect((await batch([TEN[0]])).status).toBe(201);
    const res = await batch([TEN[0]]);
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    expect(mailer.sends).toBe(10);
  });
  it("1 項目 1 依頼の SMTP の送信も同じ上限を使う（BR-006）。宛先が無く送らないときは数えない", async () => {
    const mailer = countingMailer();
    const { post, batch } = buildBatch({ mailer });
    for (let i = 0; i < 10; i++)
      expect(
        (await post("/api/requests", { profile: profile4, assetId: "admin", mitigation: "M1026" }))
          .status,
      ).toBe(201);
    expect(
      (await post("/api/requests", { profile: profile4, assetId: "admin", mitigation: "M1026" }))
        .status,
    ).toBe(429);
    expect((await batch([TEN[0]])).status).toBe(429);
  });
  it("送信箱だけ（OutboxMailer）のときは当たらない", async () => {
    const { batch } = buildBatch();
    for (let i = 0; i < 15; i++) expect((await batch([TEN[0]])).status).toBe(201);
  });
});

describe("SBR-013：カルテ由来の文字列の無害化", () => {
  it("会社名の CR LF、資産名の NUL と双方向制御文字、{{staff}} が、件名・本文・保存した名前に残らない", async () => {
    const { post } = buildBatch();
    const bad = {
      ...profile4,
      companyName: "A\r\nBcc: x@example.com",
      vendor: { name: `ベンダー${RLO}`, email: "vendor@example.com" },
      assets: [
        { id: "admin", role: "admin", label: `管理者${RLO}\u0000アカウント` },
        { id: "server", role: "server", label: "{{staff}}" },
      ],
    };
    const res = await post("/api/requests/batch", { profile: bad, items: [TEN[0], TEN[5]] });
    expect(res.status).toBe(201);
    const { batch, items } = await loose(res);
    for (const text of [batch.subject, batch.text, batch.companyLabel, items[0].assetLabel]) {
      expect(text).not.toMatch(UNSAFE);
    }
    expect(batch.subject).not.toMatch(/[\r\n]/);
    expect(batch.text).toContain("対象：管理者アカウント");
    expect(batch.text).toContain("対象：｛｛staff｝｝");
    expect(batch.text).not.toContain("対象：情報システム担当");
  });
  it("sanitizeName：制御文字・双方向制御・{{ }} を処理し、普通の名前は変えない", () => {
    expect(sanitizeName("デモ精工株式会社")).toBe("デモ精工株式会社");
    const odd = [0x2028, 0x2029, 0x2066, 0x2069].map((c) => String.fromCodePoint(c)).join("-");
    expect(sanitizeName(`a${odd}b${RLO}c\u007fd`)).toBe("a---bcd"); // "-" だけが残る
    expect(sanitizeName("{{x}}")).toBe("｛｛x｝｝");
  });
});

describe("BR-008：保存ファイルの権限", () => {
  it.skipIf(process.platform === "win32")(
    "新しく作る保存先は、ファイル 0600・親ディレクトリ 0700",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "uchidai-perm-"));
      try {
        const file = join(root, "fresh", "requests.json");
        const store = new RequestStore({ file });
        const app = autoExpect(new Hono()).route(
          "/api/requests",
          requestRoutes({ store, mailer: new OutboxMailer(), writer: { writer: "template" } }),
        );
        const res = await app.request("/api/requests/batch", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ profile: profile4, items: [TEN[0]] }),
        });
        expect(res.status).toBe(201);
        expect(statSync(file).mode & 0o777).toBe(0o600);
        expect(statSync(join(root, "fresh")).mode & 0o777).toBe(0o700);
        expect(JSON.parse(readFileSync(file, "utf8")).version).toBe(2);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );
});

describe("SBR-014/BR-005/BR-007：読み込みの検査", () => {
  let dir: string;
  let file: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "uchidai-load-"));
    file = join(dir, "requests.json");
    pristineFile = undefined;
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  /** 本物の経路で作った保存を、読み直して返す（親 1 ＋ 子 3、1 問目は回答済み） */
  async function seeded() {
    const store = new RequestStore({ file, now: () => new Date("2026-11-07T10:00:00Z") });
    const app = autoExpect(new Hono()).route(
      "/api/requests",
      requestRoutes({
        store,
        mailer: new OutboxMailer(),
        writer: { writer: "template" },
        now: () => new Date("2026-11-07T10:00:00Z"),
      }),
    );
    const post = (path: string, body: unknown) =>
      app.request(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    const { batch, items } = await loose(
      await post("/api/requests/batch", { profile: profile4, items: [TEN[0], TEN[5], TEN[9]] }),
    );
    await post(`/api/requests/batch/${batch.id}/reply`, {
      repliedBy: "田中",
      receivedAt: "2026-11-07T09:00:00Z",
      answers: [{ requestId: items[0].id, choice: "shared" }],
    });
    return { batch, items };
  }
  /** 保存を書き換えて読み直す。書き換えは、いつも最初に seeded で作った内容から始める */
  let pristineFile: Buffer | undefined;
  const edit = (fn: (items: Loose[]) => Loose[]) => {
    pristineFile ??= readFileSync(file);
    writeFileSync(file, pristineFile);
    const j = JSON.parse(readFileSync(file, "utf8"));
    j.items = fn(j.items);
    writeFileSync(file, JSON.stringify(j));
    return new RequestStore({ file });
  };
  const quiet = () => vi.spyOn(console, "error").mockImplementation(() => undefined);

  it("そのまま読み直せる：親 1 ＋ 子 3、回答も残る", async () => {
    const { items } = await seeded();
    const again = new RequestStore({ file });
    expect(again.size).toBe(4);
    expect(again.byId(items[0].id)?.answer?.choice).toBe("shared");
    expect(again.listBatches()[0]?.childIds).toEqual(items.map((i: Loose) => i.id));
  });
  it("answer の evidence を external に書き換えると、その answer だけ落ちる（依頼は残る）。警告が出る", async () => {
    const { items } = await seeded();
    const warn = quiet();
    const s = edit((xs) =>
      xs.map((x) =>
        x.id === items[0].id
          ? { ...x, answer: { ...x.answer, input: { ...x.answer.input, evidence: "external" } } }
          : x,
      ),
    );
    expect(s.byId(items[0].id)).toBeDefined();
    expect(s.byId(items[0].id)?.answer).toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
  it("answer の assetId・mitigation・choice・status が依頼と合わなければ落ちる", async () => {
    const { items } = await seeded();
    const warn = quiet();
    for (const patch of [
      (a: Loose) => ({ ...a, input: { ...a.input, assetId: "OTHER" } }),
      (a: Loose) => ({ ...a, input: { ...a.input, mitigation: "M9999" } }),
      (a: Loose) => ({ ...a, choice: "zzz" }),
      (a: Loose) => ({ ...a, input: { ...a.input, status: "present" } }),
    ]) {
      const s = edit((xs) =>
        xs.map((x) => (x.id === items[0].id && x.answer ? { ...x, answer: patch(x.answer) } : x)),
      );
      expect(s.byId(items[0].id)?.answer).toBeUndefined();
    }
    warn.mockRestore();
  });
  it("親の無い子、子の無い親、親と profileId／to が違う子は捨てる", async () => {
    const { batch, items } = await seeded();
    const warn = quiet();
    // 親を消す → 子 3 件も落ちる（孤児を作らない）
    expect(edit((xs) => xs.filter((x) => x.id !== batch.id)).size).toBe(0);
    // 子を全部消す → 親も落ちる
    expect(edit((xs) => xs.filter((x) => x.parentId !== batch.id)).size).toBe(0);
    // 1 件だけ profileId／to が違う子は、その子だけ落ちる。親の childIds も直る
    const s1 = edit((xs) =>
      xs.map((x) => (x.id === items[1].id ? { ...x, profileId: "other" } : x)),
    );
    expect(s1.size).toBe(3);
    expect(s1.listBatches()[0]?.childIds).toEqual([items[0].id, items[2].id]);
    const s2 = edit((xs) =>
      xs.map((x) => (x.id === items[2].id ? { ...x, to: "evil@example.com" } : x)),
    );
    expect(s2.byId(items[2].id)).toBeUndefined();
    warn.mockRestore();
  });
  it("question.choices と choiceMap の並びが違う項目は捨てる（BR-007）", async () => {
    const { items } = await seeded();
    const warn = quiet();
    const s = edit((xs) =>
      xs.map((x) => (x.id === items[2].id ? { ...x, choiceMap: [...x.choiceMap].reverse() } : x)),
    );
    expect(s.byId(items[2].id)).toBeUndefined();
    warn.mockRestore();
  });
  it("古い版（version 1。親子の無い項目）はそのまま読める", async () => {
    const store = new RequestStore({ file });
    const app = autoExpect(new Hono()).route(
      "/api/requests",
      requestRoutes({ store, mailer: new OutboxMailer(), writer: { writer: "template" } }),
    );
    await app.request("/api/requests", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profile: profile4, assetId: "admin", mitigation: "M1026" }),
    });
    const j = JSON.parse(readFileSync(file, "utf8"));
    j.version = 1;
    writeFileSync(file, JSON.stringify(j));
    expect(new RequestStore({ file }).size).toBe(1);
  });
});

describe("SBR-015：エラー応答に内部情報を出さない", () => {
  const leaks = /\/Users\/|node_modules|\n\s+at |\bat .*\(.*:\d+:\d+\)|SMTP_URL|ANTHROPIC/;
  it("形の違う配列・11 件・壊れた JSON は 400 で、パスもスタックも出さない", async () => {
    const { app, post, store } = buildBatch();
    const res1 = await post("/api/requests/batch", { profile: profile4, items: "x" });
    const res2 = await post("/api/requests/batch", {
      profile: profile4,
      items: [...TEN, ELEVENTH],
    });
    const res3 = await app.request("/api/requests/batch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{broken",
    });
    const res4 = await app.request("/api/requests/batch/x/reply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ answers: [] }),
    });
    for (const r of [res1, res2, res3, res4]) {
      expect(r.status).toBe(400);
      expect(JSON.stringify(await r.json())).not.toMatch(leaks);
    }
    expect(store.size).toBe(0);
  });
  it("保存に失敗しても（内部のパスを含む例外）、応答にはパスを出さず、何も積まれたままにならない", async () => {
    const root = mkdtempSync(join(tmpdir(), "uchidai-err-"));
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const blocker = join(root, "blocker");
      writeFileSync(blocker, "x");
      const store = new RequestStore({ file: join(blocker, "sub", "requests.json") });
      const app = autoExpect(new Hono()).route(
        "/api/requests",
        requestRoutes({ store, mailer: new OutboxMailer(), writer: { writer: "template" } }),
      );
      const res = await app.request("/api/requests/batch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ profile: profile4, items: [TEN[0]] }),
      });
      expect(res.status).toBe(500);
      const text = JSON.stringify(await res.json());
      expect(text).not.toContain(root);
      expect(text).not.toMatch(leaks);
      expect(store.size).toBe(0);
    } finally {
      err.mockRestore();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("SBR-016：プレビューの文面と、保存した文面は同じ", () => {
  it("プレビューの subject・text が、作った親の subject・text と GET / の親に一致する（expectText を渡す）", async () => {
    const { post, list } = buildBatch();
    const pv = await loose(
      await post("/api/requests/batch/preview", { profile: profile4, items: TEN.slice(0, 4) }),
    );
    expect(pv.items).toHaveLength(4);
    expect(pv.to).toBe("vendor@example.com");
    const res = await post("/api/requests/batch", {
      profile: profile4,
      items: TEN.slice(0, 4),
      to: pv.to,
      deadline: pv.deadline,
      expectText: pv.text,
    });
    expect(res.status).toBe(201);
    const { batch } = await loose(res);
    expect(batch.text).toBe(pv.text);
    expect(batch.subject).toBe(pv.subject);
    const l = await list();
    expect(l.batches[0].text).toBe(pv.text);
  });
  it("プレビューは保存も送信もしない", async () => {
    const mailer = countingMailer();
    const { post, store } = buildBatch({ mailer });
    expect(
      (await post("/api/requests/batch/preview", { profile: profile4, items: TEN })).status,
    ).toBe(200);
    expect(mailer.sends).toBe(0);
    expect(store.size).toBe(0);
  });
  it("確認した文面と違えば 409 で、保存も送信もしない", async () => {
    const mailer = countingMailer();
    const { post, store } = buildBatch({ mailer });
    const res = await post("/api/requests/batch", {
      profile: profile4,
      items: [TEN[0]],
      expectText: "別の文面",
    });
    expect(res.status).toBe(409);
    expect(store.size).toBe(0);
    expect(mailer.sends).toBe(0);
  });
});
