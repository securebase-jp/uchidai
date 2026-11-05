/**
 * 入口の種類（entry-kinds.yaml）：記事の入口を、手法 ID でなく種類で会社カルテの入口の資産に対応づける（C2）。
 * 実記事の試験（TRIAL-004、D-003、R-003、S-002、R-006、D-004）で出た誤りを固定する
 */
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  COVERAGE_GAP_HEADLINE,
  entryKindGapHeadline,
  entryKindGapNote,
  evaluate,
} from "./evaluate.ts";
import { profileFromAnswers } from "./graph.ts";
import { EntryKindDef, type Knowledge, loadKnowledge, loadProfile, repoRoot } from "./knowledge.ts";
import { buildOnePager } from "./onepager.ts";
import type { Case, CompanyProfile, ProfileAnswers } from "./types.ts";

let k: Knowledge;
let demo: CompanyProfile;
beforeAll(() => {
  k = loadKnowledge();
  demo = loadProfile(join(repoRoot, "examples", "demo-seiko.json"));
});

/** 入口の段階だけが記事に書かれた、ランサムウェアの事例 */
const entryCase = (
  entryKind: string | undefined,
  technique = "T1133",
  extra: Partial<Case> = {},
): Case => ({
  title: "t",
  damageType: "ransomware",
  clarity: "partial",
  suspiciousInstructions: [],
  steps: [
    {
      tactic: "TA0001",
      techniques: [technique],
      source: "stated",
      ...(entryKind ? { entryKind } : {}),
    },
    { tactic: "TA0040", techniques: ["T1486"], source: "stated" },
  ],
  ...extra,
});
const frame = (remoteAccess: ProfileAnswers["remoteAccess"]) =>
  profileFromAnswers(
    {
      industry: "wholesale_service",
      site: "office_only",
      hosting: { mail: "cloud", files: "onprem", core: "onprem", web: "provider" },
      remoteAccess,
      backup: "same_network",
    },
    k.patterns,
    "試験用商事",
    k.sites,
  );
const entryOf = (v: ReturnType<typeof evaluate>) =>
  v.paths.map((p) => [p.steps[0]?.role, p.source] as const);

describe("入口の種類の宣言", () => {
  it("entry-kinds.yaml の種類は、役割の枠にある", () => {
    expect(k.entryKinds.map((x) => x.id)).toEqual(
      expect.arrayContaining(["vpn", "rdp", "vendor", "mail", "web", "credential"]),
    );
    for (const kind of k.entryKinds)
      for (const r of kind.roles) expect(k.roles.some((x) => x.id === r)).toBe(true);
  });
});

describe("入口の種類が分かるとき、一致する種類の資産だけを入口にする", () => {
  it("TRIAL-004：リモートデスクトップの記事は、VPN 装置だけのカルテでは VPN に当てず「未登録」", () => {
    // 従来：手法 T1133 だけで、カルテの VPN 装置に「記載」で当たった
    expect(entryOf(evaluate(entryCase(undefined), demo, { knowledge: k }))[0]).toEqual([
      "entry.vpn",
      "stated",
    ]);
    const v = evaluate(entryCase("rdp"), demo, { knowledge: k });
    expect(v.paths).toEqual([]);
    expect(v.result).toBe("no_entry");
    expect(v.headlineJa).toBe(entryKindGapHeadline({ labelJa: "リモートデスクトップ" }));
    expect(v.coverageGapJa).toBe(entryKindGapNote({ labelJa: "リモートデスクトップ" }));
    expect(v.coverageGapJa).toMatch(/登録が足りない可能性/);
  });
  it("R-003：VPN の記事は、リモートデスクトップだけの 5 問のカルテで RDP に当てず pending", () => {
    const v = evaluate(entryCase("vpn", "T1190"), frame(["rdp"]), { knowledge: k });
    expect(v.paths).toEqual([]);
    expect(v.result).toBe("pending");
    expect(v.headlineJa).toMatch(/VPN 装置/);
  });
  it("リモートデスクトップの記事 × RDP を持つ 5 問のカルテは、RDP に「記載」で当たる", () => {
    const v = evaluate(entryCase("rdp"), frame(["rdp"]), { knowledge: k });
    expect(entryOf(v)).toEqual([["entry.rdp", "stated"]]);
    expect(v.result).not.toBe("no_entry");
  });
  it("委託先（vendor）は保守接続だけに、VPN の記事は VPN 装置だけに当たる", () => {
    expect(entryOf(evaluate(entryCase("vendor"), demo, { knowledge: k }))).toEqual([
      ["entry.vendor_remote", "stated"],
    ]);
    expect(entryOf(evaluate(entryCase("vpn", "T1190"), demo, { knowledge: k }))).toEqual([
      ["entry.vpn", "stated"],
    ]);
  });
  it("S-002：遠隔接続の無い（クラウドだけの）カルテで VPN の記事は、フィッシングの候補に切り替えない", () => {
    const v = evaluate(entryCase("vpn", "T1190"), frame(["cloud_only"]), { knowledge: k });
    expect(v.paths).toEqual([]);
    expect(v.result).toBe("pending");
  });
  it("メールの記事は社員PCに当たる", () => {
    const v = evaluate(entryCase("mail", "T1566.002"), demo, { knowledge: k });
    expect(entryOf(v)).toEqual([["pc", "stated"]]);
  });
  it("正規の認証情報（ログイン先は不明）は、どの資産も「記載」とは言わず、候補として並べる", () => {
    const v = evaluate(entryCase("credential", "T1078"), frame(["vpn", "rdp"]), { knowledge: k });
    const sources = new Set(v.paths.map((p) => p.source));
    expect(sources).toEqual(new Set(["candidate"]));
    expect(v.paths.map((p) => p.steps[0]?.role)).toEqual(
      expect.arrayContaining(["entry.vpn", "entry.rdp"]),
    );
  });
  it("入口の種類が分からない（省略）ときは、これまでどおり（手法 ID で対応づける）", () => {
    const v = evaluate(entryCase(undefined, "T1190"), demo, { knowledge: k });
    expect(entryOf(v)[0]).toEqual(["entry.vpn", "stated"]);
  });
  it("型紙の入口にその種類の役割が無いときは、種類を使わない（なりすまし送金など）", () => {
    const bec: Case = {
      title: "t",
      damageType: "bec",
      clarity: "clear",
      suspiciousInstructions: [],
      steps: [
        { tactic: "TA0001", techniques: ["T1078.004"], source: "stated", entryKind: "rdp" },
        { tactic: "TA0005", techniques: ["T1684.001"], source: "stated" },
      ],
    };
    expect(evaluate(bec, demo, { knowledge: k }).result).not.toBe("no_entry");
  });
});

describe("未登録の入口：一枚と見出し", () => {
  it("一枚の「何が起きるか」は、記事の入口の種類と登録不足を書く。専門用語・ID は無い", () => {
    const v = evaluate(entryCase("rdp"), demo, { knowledge: k });
    const op = buildOnePager(v, demo, k);
    expect(op.whatHappensJa.join("")).toContain("記事の入口は「リモートデスクトップ」");
    expect(op.whatHappensJa.join("")).toMatch(/登録されていません/);
    expect(op.whatHappensJa.join("")).not.toMatch(/T\d{4}/);
  });
  it("TRIAL-002 の「カルテの範囲では入口はありません」とは別の文言", () => {
    const v = evaluate(entryCase("rdp"), frame(["vpn"]), { knowledge: k });
    expect(v.headlineJa).not.toBe(COVERAGE_GAP_HEADLINE);
  });
});

describe("拡張性：新しい入口の種類は YAML だけで足せる", () => {
  it("kinds に 1 件足すだけで、その種類の資産だけが入口になる", () => {
    const withKind: Knowledge = {
      ...k,
      entryKinds: [
        ...k.entryKinds,
        EntryKindDef.parse({
          id: "wifi",
          labelJa: "社内の無線 LAN",
          roles: ["entry.rdp"],
          readingHintJa: "テスト用",
        }),
      ],
    };
    const v = evaluate(entryCase("wifi"), frame(["vpn", "rdp"]), { knowledge: withKind });
    expect(entryOf(v)).toEqual([["entry.rdp", "stated"]]);
    // 定義にない種類は無視する（これまでどおり）
    expect(entryOf(evaluate(entryCase("nothing"), demo, { knowledge: k }))[0]).toEqual([
      "entry.vpn",
      "stated",
    ]);
  });
});

describe("第三者の事故：記事の入口の資産がカルテに無くても「入口なし」にしない（TRIAL-I-007）", () => {
  const thirdCase = (victim: string, entryKind: string, technique: string): Case => ({
    title: "t",
    damageType: "data_breach",
    clarity: "partial",
    suspiciousInstructions: [],
    victim,
    steps: [
      { tactic: "TA0001", techniques: [technique], source: "stated", entryKind },
      { tactic: "TA0010", techniques: ["T1041"], source: "stated" },
    ],
  });
  it("提供元 × 正規の認証情報：第三者の事故の見出し、確認すること、入口は「記事の入口は〇〇（記載）。御社が同じ立場なら」の想定", () => {
    const v = evaluate(thirdCase("provider", "credential", "T1078"), demo, { knowledge: k });
    expect(v.result).not.toBe("no_entry");
    expect(v.headlineJa).toMatch(
      /^これはクラウド・ソフトウェアの提供元で起きた事故です。御社が同じ立場なら/,
    );
    expect(v.thirdParty?.checksJa.length).toBeGreaterThan(0);
    const text = buildOnePager(v, demo, k).whatHappensJa.join("\n");
    expect(text).toContain(
      "記事の入口は「正規の認証情報（ログイン先は不明）」（記載）。御社が同じ立場なら、攻撃は次の順に進むと見込まれます：入口から侵入される",
    );
    expect(text).not.toMatch(/登録されていません/);
    expect(text).not.toMatch(/VPN装置が/);
    expect(text).toContain("御社が確認すること：");
  });
  it("委託先 × 公開 Web：同じく「入口なし」にせず、入口は記載の想定。推定なら（推定）と書く", () => {
    const v = evaluate(thirdCase("vendor", "web", "T1190"), demo, { knowledge: k });
    expect(v.result).not.toBe("no_entry");
    expect(v.headlineJa).toMatch(/^これは委託先・取引先で起きた事故です。御社が同じ立場なら/);
    expect(buildOnePager(v, demo, k).whatHappensJa.join("\n")).toContain(
      "記事の入口は「公開 Web サイト・Web アプリ」（記載）。御社が同じ立場なら",
    );
    const inferred = thirdCase("vendor", "web", "T1190");
    inferred.steps[0] = { ...(inferred.steps[0] as Case["steps"][number]), source: "inferred" };
    const w = evaluate(inferred, demo, { knowledge: k });
    expect(buildOnePager(w, demo, k).whatHappensJa.join("\n")).toContain(
      "記事の入口は「公開 Web サイト・Web アプリ」（推定）。",
    );
  });
  it("Web 経由の型紙で、カルテのどの入口からも経路が作れないとき：結論は変えないが、「登録が足りない」でなく第三者の事故の見出しと確認", () => {
    // ir-xebio の形：EC プラットフォーム事業者（提供元）の管理用認証情報から、Web の型紙。デモ精工の公開サイトは社内につながらない
    const xebio: Case = {
      title: "EC プラットフォームへの不正アクセス",
      damageType: "data_breach",
      clarity: "partial",
      suspiciousInstructions: [],
      victim: "provider",
      steps: [
        { tactic: "TA0001", techniques: ["T1078"], source: "stated", entryKind: "credential" },
        { tactic: "TA0009", techniques: ["T1213"], source: "stated" },
        { tactic: "TA0040", techniques: ["T1491.002"], source: "stated" },
      ],
    };
    const v = evaluate(xebio, demo, { knowledge: k });
    expect(v.headlineJa).toBe(
      "これはクラウド・ソフトウェアの提供元で起きた事故です。御社のカルテには、記事の入口に当たる設備が見つかりません",
    );
    expect(v.thirdParty?.id).toBe("provider");
    const text = buildOnePager(v, demo, k).whatHappensJa.join("\n");
    expect(text).toContain(
      "記事の入口は「正規の認証情報（ログイン先は不明）」（記載）で、クラウド・ソフトウェアの提供元の設備です。",
    );
    expect(text).not.toMatch(/登録が足りない可能性/);
    expect(text).toContain("御社が確認すること：");
    // 自社の事故なら、これまでどおり登録の不足として答える
    const { victim: _v, ...own } = xebio;
    expect(evaluate(own, demo, { knowledge: k }).headlineJa).toBe(
      entryKindGapHeadline({ labelJa: "正規の認証情報（ログイン先は不明）" }),
    );
  });
  it("5 問のカルテ（既定の枠）でも、第三者の事故なら「登録されていません」にしない", () => {
    const v = evaluate(thirdCase("vendor", "web", "T1190"), frame(["vpn"]), { knowledge: k });
    expect(v.headlineJa).toMatch(/^これは委託先・取引先で起きた事故です/);
    expect(v.coverageGapJa).toBeUndefined();
  });
  it("自社の事故は、これまでどおり「入口は未登録」（第三者の事故だけの変更）", () => {
    const own = thirdCase("self", "rdp", "T1133");
    const { victim: _v, ...plain } = own;
    const v = evaluate(plain, demo, { knowledge: k });
    expect(v.result).toBe("no_entry");
    expect(v.paths).toEqual([]);
  });
});

describe("入口が正規の認証情報のとき、想定の候補に VPN を置かず「記事の入口は〇〇（記載）」と書く（TRIAL-I-008 の暫定）", () => {
  const credCase = (source: "stated" | "inferred" = "stated"): Case => ({
    title: "リスト型の不正ログイン",
    damageType: "data_breach",
    clarity: "partial",
    suspiciousInstructions: [],
    steps: [
      { tactic: "TA0001", techniques: ["T1078"], source, entryKind: "credential" },
      { tactic: "TA0010", techniques: ["T1041"], source: "stated" },
    ],
  });
  it("記載：「入口はまだ分かっていません。たとえば VPN装置から」でなく、「記事の入口は〇〇（記載）。」", () => {
    const v = evaluate(credCase(), demo, { knowledge: k });
    const text = buildOnePager(v, demo, k).whatHappensJa.join("\n");
    expect(text).toContain(
      "記事の入口は「正規の認証情報（ログイン先は不明）」（記載）。攻撃は次の順に進みます：入口から侵入される",
    );
    expect(text).not.toContain("入口はまだ分かっていません");
    expect(text).not.toMatch(/VPN装置/);
  });
  it("判定そのもの（経路・結論）は変えない", () => {
    const v = evaluate(credCase(), demo, { knowledge: k });
    expect(v.paths.every((p) => p.source === "candidate")).toBe(true);
    expect(v.paths.every((p) => p.statedEntry?.kindId === "credential")).toBe(true);
  });
  it("入口が書かれていないとき（unknown）は、これまでどおり「入口はまだ分かっていません。たとえば〜」", () => {
    const unknown: Case = {
      ...credCase(),
      clarity: "unknown",
      steps: [
        { tactic: "TA0001", techniques: [], source: "unknown" },
        { tactic: "TA0010", techniques: ["T1041"], source: "stated" },
      ],
    };
    const text = buildOnePager(
      evaluate(unknown, demo, { knowledge: k }),
      demo,
      k,
    ).whatHappensJa.join("\n");
    expect(text).toContain("入口はまだ分かっていません。たとえば「");
    expect(text).not.toContain("記事の入口は");
  });
});
