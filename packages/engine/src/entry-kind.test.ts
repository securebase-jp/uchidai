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
