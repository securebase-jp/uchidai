/**
 * 知見なしの一般的な AI が挙げた対策（緩和策 ID）を、判定結果の経路に照らして振り分ける
 */
import type { LabelsFile } from "./knowledge.ts";
import type { MitigationId, Verdict } from "./types.ts";

export type MitigationClass = {
  effective: { mitigation: MitigationId; labelJa: string; stageLabelJa: string }[];
  ineffective: {
    mitigation: MitigationId;
    labelJa: string;
    stageLabelJa: string;
    reasonJa: string;
  }[];
  outside: { mitigation: MitigationId; labelJa: string }[];
};

export function classifyMitigations(
  mitigations: string[],
  verdict: Verdict,
  labels?: LabelsFile,
): MitigationClass {
  const label = (id: string) => labels?.mitigations[id] ?? labels?.custom[id]?.labelJa ?? id;
  const out: MitigationClass = { effective: [], ineffective: [], outside: [] };
  const steps = verdict.paths.filter((p) => p.source !== "ai").flatMap((p) => p.steps);
  for (const id of new Set(mitigations)) {
    const inef = steps.find((s) => s.ineffective.some((i) => i.mitigation === id));
    if (inef) {
      const reason = inef.ineffective.find((i) => i.mitigation === id)?.reasonJa ?? "";
      out.ineffective.push({
        mitigation: id,
        labelJa: label(id),
        stageLabelJa: inef.labelJa ?? inef.role,
        reasonJa: reason,
      });
      continue;
    }
    const eff = steps.find((s) => s.mitigations.includes(id));
    if (eff) {
      out.effective.push({
        mitigation: id,
        labelJa: label(id),
        stageLabelJa: eff.labelJa ?? eff.role,
      });
      continue;
    }
    out.outside.push({ mitigation: id, labelJa: label(id) });
  }
  return out;
}
