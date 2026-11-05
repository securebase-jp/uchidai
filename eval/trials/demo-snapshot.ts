/**
 * デモの結果の同一確認：記録済みの IPA 5 事例 × 架空企業 3 社の、結論・見出し・一枚の「何が起きるか」を JSON で出す。
 * 変更の前後で出力を比べ、デモの画面・動画に映る結果が変わっていないことを確かめる（Claude は呼ばない）
 *   node --disable-warning=ExperimentalWarning eval/trials/demo-snapshot.ts > snapshot.json
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildOnePager, Case, evaluate, loadKnowledge, loadProfile, repoRoot } from "@uchidai/engine";

const k = loadKnowledge();
const out: Record<string, unknown> = {};
for (const company of ["demo-seiko", "demo-bussan", "demo-clinic"]) {
  const profile = loadProfile(join(repoRoot, "examples", `${company}.json`));
  for (const n of [1, 2, 3, 4, 5]) {
    const rec = JSON.parse(
      readFileSync(join(repoRoot, "eval", "recordings", `ipa-case-${n}.with-knowledge.json`), "utf8"),
    ) as { output: unknown };
    const theCase = Case.parse({ ...(rec.output as object), suspiciousInstructions: [] });
    const v = evaluate(theCase, profile, { knowledge: k });
    out[`${company} × ipa-case-${n}`] = {
      result: v.result,
      headlineJa: v.headlineJa,
      paths: v.paths.map((p) => p.steps.map((s) => [s.role, s.state, s.source])),
      impact: v.impact,
      timeline: v.timeline.map((e) => [e.day, e.kind, e.labelJa]),
      onePager: buildOnePager(v, profile, k, { caseTitle: theCase.title }),
    };
  }
}
console.log(JSON.stringify(out, null, 1));
