/**
 * 出来事の確度（certainty）が、判定の経路と一枚のテンプレート文に渡ること。
 * 確度の印が無い（これまでの）事例の文は変わらないこと
 */
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { evaluate } from "./evaluate.ts";
import { type Knowledge, loadKnowledge, loadProfile, repoRoot } from "./knowledge.ts";
import { buildOnePager } from "./onepager.ts";
import type { Case, CaseStep, CompanyProfile } from "./types.ts";

let k: Knowledge;
let demo: CompanyProfile;
beforeAll(() => {
  k = loadKnowledge();
  demo = loadProfile(join(repoRoot, "examples", "demo-seiko.json"));
});

const steps = (exfil?: Partial<CaseStep>): CaseStep[] => [
  { tactic: "TA0001", techniques: ["T1190"], source: "stated" },
  { tactic: "TA0040", techniques: ["T1486"], source: "stated" },
  ...(exfil
    ? [{ tactic: "TA0010", techniques: ["T1041"], source: "stated", ...exfil } as CaseStep]
    : []),
];
const caseOf = (s: CaseStep[]): Case => ({
  title: "t",
  damageType: "ransomware",
  clarity: "partial",
  suspiciousInstructions: [],
  steps: s,
});
const lines = (c: Case) => {
  const v = evaluate(c, demo, { knowledge: k });
  return buildOnePager(v, demo, k).whatHappensJa;
};

describe("一枚のテンプレート文は、記事の書き方（確度）を守る", () => {
  it("確度の印が無い事例の文は、これまでと同じ（デモ精工の事例が変わらない）", () => {
    const l = lines(caseOf(steps()));
    expect(l[0]).toMatch(/^攻撃は次の順に進みます：/);
    expect(l.join("")).not.toMatch(/痕跡|主張|可能性があるとされ|閲覧できる状態/);
  });
  it("PathStep に certainty が入る（記事に対応づいた段階だけ）", () => {
    const v = evaluate(caseOf(steps({ source: "inferred", certainty: "no_trace" })), demo, {
      knowledge: k,
    });
    const certs = v.paths.flatMap((p) => p.steps.map((s) => s.certainty).filter(Boolean));
    expect(certs).toContain("no_trace");
  });
  it("痕跡なし：持ち出しを「起きた出来事」として並べず、別の文で「痕跡は確認されていません」", () => {
    const l = lines(caseOf(steps({ source: "inferred", certainty: "no_trace" })));
    const joined = l.join("\n");
    expect(joined).toMatch(/痕跡は確認されていません/);
    expect(l[0]).not.toMatch(/持ち出/);
  });
  it("攻撃者の主張：事実かどうか確認されていないと書く", () => {
    expect(lines(caseOf(steps({ source: "inferred", certainty: "claimed" }))).join("\n")).toMatch(
      /攻撃者の主張で、事実かどうかは確認されていません/,
    );
  });
  it("可能性：確認された事実ではないと書き、閲覧できる状態だけ：取得は確認されていないと書く", () => {
    expect(lines(caseOf(steps({ source: "inferred", certainty: "possible" }))).join("\n")).toMatch(
      /可能性があるとされています（確認された事実ではありません）/,
    );
    expect(
      lines(caseOf(steps({ source: "inferred", certainty: "exposed_only" }))).join("\n"),
    ).toMatch(/閲覧できる状態でしたが、実際に取得されたかは確認されていません/);
  });
});
