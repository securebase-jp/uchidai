/**
 * AI攻撃者が提案した経路の検証。検証を通らない経路は破棄する
 *  (a) 手法 ID が実在する（廃止 ID は置き換え）
 *  (b) 役割がグラフに実在する
 *  (c) 連続する役割の間に通信エッジが実在し、最初の役割は攻撃者とつながっている
 *  (d) 各段階に評価できる判定ルールがある
 */
import { z } from "zod";
import { ATTACKER_NODE_ID, adjacent } from "./graph.ts";
import { canonicalTechnique, type Knowledge, loadKnowledge } from "./knowledge.ts";
import { evaluateRule, findRule } from "./rules.ts";
import {
  type AttackPath,
  type CompanyProfile,
  type Contradiction,
  type Graph,
  type PathStep,
  Role,
  TechniqueId,
} from "./types.ts";

export const AiPathCandidate = z.object({
  titleJa: z.string().max(60).optional(),
  steps: z
    .array(
      z.object({
        role: Role,
        technique: TechniqueId,
        reasonJa: z.string().max(120),
      }),
    )
    .min(2)
    .max(6),
});
export type AiPathCandidate = z.infer<typeof AiPathCandidate>;

export type AiPathValidation =
  | { ok: true; path: AttackPath; contradictions: Contradiction[] }
  | { ok: false; reasons: string[] };

export function terminalRoles(knowledge: Knowledge): Set<string> {
  return new Set(
    knowledge.templates.flatMap((t) =>
      t.stages.filter((s) => s.terminal).flatMap((s) => Object.keys(s.byRole)),
    ),
  );
}

export function validateAiPath(
  candidate: unknown,
  graph: Graph,
  profile: CompanyProfile,
  knowledge: Knowledge = loadKnowledge(),
  id = "ai",
): AiPathValidation {
  const parsed = AiPathCandidate.safeParse(candidate);
  if (!parsed.success)
    return {
      ok: false,
      reasons: [`スキーマ外の出力：${parsed.error.issues.map((i) => i.message).join("、")}`],
    };
  const reasons: string[] = [];
  const steps: PathStep[] = [];
  const contradictions: Contradiction[] = [];
  let prevId = ATTACKER_NODE_ID;
  let stopped = false;

  for (const [i, s] of parsed.data.steps.entries()) {
    const technique = canonicalTechnique(s.technique, knowledge.attack);
    if (!technique)
      reasons.push(
        `段階 ${i + 1}: 手法 ${s.technique} は ATT&CK v${knowledge.attack.version} に存在しない`,
      );
    const node =
      graph.nodes.find((n) => n.role === s.role && adjacent(graph, prevId, n.id)) ??
      graph.nodes.find((n) => n.role === s.role);
    if (!node) {
      reasons.push(`段階 ${i + 1}: 役割 ${s.role} は構成グラフにない`);
      continue;
    }
    if (!adjacent(graph, prevId, node.id))
      reasons.push(`段階 ${i + 1}: ${prevId} と ${node.id} の間に通信のつながりがない`);
    const rule = findRule(knowledge.rules, node.role, technique);
    if (!rule)
      reasons.push(
        `段階 ${i + 1}: 役割 ${s.role} と手法 ${s.technique} を評価する判定ルールがない`,
      );
    const asset = profile.assets.find((a) => a.id === node.assetId);
    const tech = knowledge.attack.techniques.find((t) => t.id === technique);
    const base = {
      nodeId: node.id,
      role: node.role,
      tactic: tech?.tactics[0] ?? "TA0001",
      ...(technique ? { technique } : {}),
      source: "ai" as const,
      labelJa: s.reasonJa,
      reasonJa: s.reasonJa,
    };
    if (rule && asset && !stopped) {
      const r = evaluateRule(rule, asset, contradictions);
      steps.push({
        ...base,
        mitigations: r.mitigations,
        ineffective: r.ineffective,
        state: r.state,
        evidence: r.evidence,
        ruleId: r.ruleId,
        reasonJa: r.reasonJa,
      });
      if (r.state === "blocked") stopped = true;
    } else if (rule && !stopped) {
      steps.push({
        ...base,
        mitigations: rule.mitigations,
        ineffective: [],
        state: "breached",
        evidence: "none",
        ruleId: rule.id,
        reasonJa: "到達",
      });
    }
    prevId = node.id;
  }
  if (reasons.length > 0) return { ok: false, reasons };

  const lastRole = steps[steps.length - 1]?.role ?? "";
  const reachedCore = !stopped && terminalRoles(knowledge).has(lastRole);
  const reachedAssetIds = steps
    .filter((s) => s.state !== "blocked")
    .map((s) => graph.nodes.find((n) => n.id === s.nodeId)?.assetId)
    .filter((x): x is string => x !== undefined);
  return {
    ok: true,
    path: { id, source: "ai", steps, reachedCore, reachedAssetIds },
    contradictions,
  };
}
