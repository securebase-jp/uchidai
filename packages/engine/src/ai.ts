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

/** 型紙がその役割の典型手法として挙げる手法 */
export function typicalTechniques(knowledge: Knowledge, role: string): Set<string> {
  const out = new Set<string>();
  for (const t of knowledge.templates)
    for (const s of t.stages) {
      const tech = s.byRole[role];
      if (tech) out.add(tech);
      if (role in s.byRole) for (const a of s.accepts) out.add(a);
    }
  return out;
}

/** 表示用の戦術：最初の段階は初期アクセス（TA0001）を優先し、以降は最初に挙がる戦術 */
function pickTactic(tactics: string[], first: boolean): string {
  if (first && tactics.includes("TA0001")) return "TA0001";
  return tactics[0] ?? "TA0001";
}

export function terminalRoles(knowledge: Knowledge): Set<string> {
  return new Set(
    knowledge.templates.flatMap((t) =>
      t.stages.filter((s) => s.terminal).flatMap((s) => Object.keys(s.byRole)),
    ),
  );
}

export type ValidateAiPathOptions = {
  /**
   * 到達とみなす役割。省略時は全型紙の終点の役割（中核、ファイルサーバ、クラウドストレージ、公開ホームページ、資金の流出）。
   * AI攻撃者の目標が中核だけなら { terminalRoles: new Set(["core"]) } を渡す（ホームページで終わる経路を到達にしない）
   */
  terminalRoles?: ReadonlySet<string>;
};

export function validateAiPath(
  candidate: unknown,
  graph: Graph,
  profile: CompanyProfile,
  knowledge: Knowledge = loadKnowledge(),
  id = "ai",
  options: ValidateAiPathOptions = {},
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
    // 廃止済みと登録された資産（旧キャンペーンサイトなど）は、型紙の判定と同じく経路に使わない
    const sameRole = graph.nodes.filter((n) => n.role === s.role);
    const usable = sameRole.filter(
      (n) => profile.assets.find((a) => a.id === n.assetId)?.attrs.decommissioned !== true,
    );
    const node = usable.find((n) => adjacent(graph, prevId, n.id)) ?? usable[0];
    if (!node) {
      reasons.push(
        sameRole.length > 0
          ? `段階 ${i + 1}: 役割 ${s.role} の資産は廃止済みと登録されたものだけ`
          : `段階 ${i + 1}: 役割 ${s.role} は構成グラフにない`,
      );
      continue;
    }
    if (!adjacent(graph, prevId, node.id))
      reasons.push(`段階 ${i + 1}: ${prevId} と ${node.id} の間に通信のつながりがない`);
    // (d) 役割の既定ルール（手法を問わない「到達」）は、型紙がその役割の典型手法として挙げる手法にだけ使う
    const found = findRule(knowledge.rules, node.role, technique);
    const rule =
      found &&
      found.techniques.length === 0 &&
      technique &&
      !typicalTechniques(knowledge, node.role).has(technique)
        ? undefined
        : found;
    if (!rule)
      reasons.push(
        `段階 ${i + 1}: 役割 ${s.role} と手法 ${s.technique} を評価する判定ルールがない`,
      );
    const asset = profile.assets.find((a) => a.id === node.assetId);
    const tech = knowledge.attack.techniques.find((t) => t.id === technique);
    const base = {
      nodeId: node.id,
      role: node.role,
      tactic: pickTactic(tech?.tactics ?? [], i === 0),
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
  const terminals = options.terminalRoles ?? terminalRoles(knowledge);
  const reachedCore = !stopped && terminals.has(lastRole);
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
