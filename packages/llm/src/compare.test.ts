import { join } from "node:path";
import {
  buildGraph,
  type Case,
  evaluate,
  loadKnowledge,
  loadProfile,
  repoRoot,
} from "@uchidai/engine";
import { describe, expect, it } from "vitest";
import { caseAsArticle, compareGenericMitigations } from "./compare.ts";

const k = loadKnowledge();
const profile = loadProfile(join(repoRoot, "examples", "demo-seiko.json"));
const rec = JSON.parse(
  require("node:fs").readFileSync(
    join(repoRoot, "eval", "recordings", "ipa-case-1.with-knowledge.json"),
    "utf8",
  ),
) as { output: Case };

describe("compareGenericMitigations", () => {
  it("効く／効かない（理由つき）／経路の外／対応づけ不能に振り分ける", () => {
    const theCase: Case = { ...rec.output, suspiciousInstructions: [] };
    const verdict = evaluate(theCase, profile, {
      knowledge: k,
      graph: buildGraph(profile, k.roles),
    });
    const items = [
      { mitigationId: "M1051", nameJa: "更新", reasonJa: "入口を塞ぐ" },
      { mitigationId: "M1032", nameJa: "多要素認証", reasonJa: "認証を強くする" },
      { mitigationId: "M1017", nameJa: "研修", reasonJa: "意識を高める" },
      { nameJa: "保険に入る", reasonJa: "損失を補う" },
      { rejectedId: "M9999", nameJa: "謎の対策", reasonJa: "謎" },
    ];
    const c = compareGenericMitigations(items, verdict, k.labels);
    expect(c.effective.map((m) => m.mitigation)).toContain("M1051");
    const inef = c.ineffective.find((m) => m.mitigation === "M1032");
    expect(inef).toBeDefined();
    expect(inef?.verdictReasonJa).toBeTruthy();
    expect(inef?.nameJa).toBe("多要素認証");
    expect(c.outside.map((m) => m.mitigation)).toContain("M1017");
    expect(c.unmapped.map((m) => m.nameJa)).toEqual(["保険に入る", "謎の対策"]);
    expect(c.counts.total).toBe(5);
  });
  it("caseAsArticle は見出しと根拠文・要約を並べる", () => {
    const text = caseAsArticle({ ...rec.output, suspiciousInstructions: [] });
    expect(text.startsWith(rec.output.title)).toBe(true);
    expect(text.length).toBeGreaterThan(40);
  });
});
