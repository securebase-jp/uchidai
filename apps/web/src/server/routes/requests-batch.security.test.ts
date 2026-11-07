/**
 * セキュリティ診断（docs/security-review-batch-requests-2026-11-07.md）の試験。
 * - BR：現在の実装で見つけた問題。いまの振る舞い（通ってしまうこと）を記録している。直したら期待値を反転する
 * - SBR：まとめ依頼（POST /api/requests/batch）の実装が満たすべき要件。コードが無いので it.todo
 * - 問題なかったもの：まとめ依頼にも効く約束を固定する
 * 外へ出る通信はしない。Claude は呼ばず、書き手はテンプレートに固定する。
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fillNames, numberedChoices, REPLY_EXAMPLE_RE, vendorRequestTemplate } from "@uchidai/llm";
import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";
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
    { id: "vpn", role: "entry.vpn", label: "VPN装置" },
    { id: "server", role: "server", label: "業務サーバ" },
  ],
};

function build(over: Partial<Parameters<typeof requestRoutes>[0]> = {}) {
  const store = new RequestStore({ now: () => new Date("2026-11-07T10:00:00Z") });
  const app = new Hono().route(
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

describe("BR-001（未対応）：保存の上限を、同時の要求がすり抜ける", () => {
  it("maxRequests: 1 でも、送信を待つ間に届いた要求は全部 201 になる（直したら 1 件だけ 201、他は 429 に反転）", async () => {
    const { post, store } = build({ maxRequests: 1, mailer: slowMailer(30) });
    const results = await Promise.all([
      post("/api/requests", { profile, assetId: "admin", mitigation: "M1026" }),
      post("/api/requests", { profile, assetId: "vpn", mitigation: "M1051" }),
      post("/api/requests", { profile, assetId: "vpn", mitigation: "M1032" }),
    ]);
    expect(results.map((r) => r.status)).toEqual([201, 201, 201]);
    expect(store.size).toBe(3);
  });
});

describe("BR-002（未対応）：fillNames の置換が連鎖し、カルテ由来の文字列が別の名前に化ける", () => {
  it("会社名の {{asset}} は資産名に、資産名の {{staff}} は担当者名に化け、後から入った {{company}} は残る", () => {
    const out = fillNames("{{company}}／{{vendor}}／{{asset}}／{{staff}}", {
      companyLabel: "{{asset}}社",
      vendorLabel: "{{staff}}",
      assetLabel: "{{company}}",
    });
    // 直したら：名前の中の {{...}} はそのまま（または無害化された形で）残り、別の名前に化けない
    expect(out).toBe("{{company}}社／情報システム担当／{{company}}／情報システム担当");
  });
});

describe("BR-003（未対応）：mailto: の長さ", () => {
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

/** 双方向制御文字 RIGHT-TO-LEFT OVERRIDE（U+202E）。ソースに素の文字を置かないため */
const RLO = String.fromCodePoint(0x202e);

describe("BR-004（未対応）：カルテ由来の制御文字が件名と本文に素のまま入る", () => {
  it("会社名の CR LF、資産名の NUL と双方向制御文字（U+202E）が件名に残る（直したら取り除かれる）", async () => {
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
    expect(request.subject).toContain("\r\n");
    expect(request.subject).toContain(RLO);
    expect(request.subject).toContain("\u0000");
    // mailto: の中では符号化される（問題なかったもの）
    expect(request.mailtoUrl).not.toMatch(/[\r\n]/);
    expect(request.mailtoUrl).not.toContain("\u0000");
    expect(request.mailtoUrl).not.toContain(RLO);
  });
});

describe("BR-005（未対応）：保存ファイルの answer を読み込み時に検証していない", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });
  it("依頼と違う資産・緩和策、evidence: external の answer がそのまま読み込まれる（直したら answer だけ落ちる）", () => {
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
    const store = new RequestStore({ file });
    const it = store.byId("req_tampered");
    expect(it?.answer?.input).toMatchObject({ assetId: "OTHER", evidence: "external" });
    expect(() =>
      store.recordReply("req_tampered", {
        choice: "shared",
        repliedBy: "x",
        receivedAt: "2026-11-01T00:00:00Z",
      }),
    ).toThrow(/すでに回答/);
  });
});

describe("BR-006（未対応）：テンプレートの書き手では、依頼の作成に 1 分あたりの上限が無い", () => {
  it("send を数える Mailer で 25 回続けて作っても、すべて 201（直したら SMTP のときだけ途中から 429）", async () => {
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
    expect(statuses.every((s) => s === 201)).toBe(true);
    expect(sends).toBe(25);
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

describe("SBR：まとめ依頼（POST /api/requests/batch）の要件。実装後に埋める", () => {
  it.todo(
    "SBR-001：親と子は同じ profileId・to・companyLabel。無い資産を含む items は 404 で何も保存しない",
  );
  it.todo(
    "SBR-002：宛先は 1 件のメールアドレスの形だけ。to もカルテのメールも無ければ 400 で send を呼ばない",
  );
  it.todo(
    "SBR-003：1 回の POST /batch で mailer.send は最大 1 回。失敗しても親子は作られ sendError が残る",
  );
  it.todo(
    "SBR-004：返信の反映は原子的。1 件でも検証に落ちたら 400 で、どの子も変わらず SSE も流れない",
  );
  it.todo("SBR-005：回答済みの子を含む配列は 409 で、未回答の子にも反映しない");
  it.todo(
    "SBR-006：親の削除・取り消しは子の全取り消しと削除。孤児（親の無い子、子の無い親）を作らない",
  );
  it.todo(
    "SBR-007：items は重複を除いて 1〜10 件。保存の上限は親 1 ＋ 子 N を await の後に見て、同時の要求で超えない",
  );
  it.todo(
    "SBR-008：質問ごとに numberedChoices で番号を振り、本文・question.choices・choiceMap・入力欄が同じ並び",
  );
  it.todo(
    "SBR-009：返信の例に具体的な番号を入れない（REPLY_EXAMPLE_RE）。■ 質問 k／N の見出しが順に 1 回ずつ",
  );
  it.todo(
    "SBR-010：mailto: は符号化の約束を守る。まとめでは本文のコピーか .eml の書き出しを主にする",
  );
  it.todo(
    "SBR-011：まとめの本文に攻撃の手法 ID（T で始まる ID）と判定の材料（materialsJa）を載せない",
  );
  it.todo(
    "SBR-012：SMTP のときは 1 分あたりの通数の上限（超えたら 429 と Retry-After）。送信箱だけなら当たらない",
  );
  it.todo("SBR-013：カルテ由来の文字列の制御文字・双方向制御文字を取り除き、{{ }} を無害化する");
  it.todo(
    "SBR-014：保存ファイルの読み込みで親子の整合と answer の形を検査し、合わないものは捨てる",
  );
  it.todo("SBR-015：エラー応答に絶対パス・スタック・環境変数の名前を出さない");
  it.todo("SBR-016：画面は二重送信しない。プレビューの文面と保存した文面が一致する");
});
