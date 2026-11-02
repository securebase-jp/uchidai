/**
 * 経路の組み立てと判定：型紙 × 構成グラフ × 判定ルール表 → Verdict
 */
import { ATTACKER_NODE_ID, adjacent, buildGraph, connected } from "./graph.ts";
import { computeImpact } from "./impact.ts";
import {
  canonicalTechnique,
  type Knowledge,
  loadKnowledge,
  type Template,
  type TemplateStage,
} from "./knowledge.ts";
import { evaluateRule, findRule } from "./rules.ts";
import { buildTimeline } from "./timeline.ts";
import type {
  AttackPath,
  Case,
  CaseStep,
  CompanyProfile,
  Contradiction,
  Graph,
  GraphNode,
  Impact,
  PathSource,
  PathStep,
  Verdict,
  VerdictResult,
} from "./types.ts";

export const HEADLINES: Record<VerdictResult, string> = {
  blocked: "この経路では、うちの会社は止められます",
  mitigated: "侵入は防げませんが、被害は抑えられます",
  breached: "うちの会社は、大丈夫ではありませんでした",
  pending: "確認中（未確認の項目が残り、回答待ちです）",
  no_entry: "この攻撃の入口は御社にはありません",
  out_of_scope: "この事故は攻撃経路で判定できないため、対象外です",
};

export type EvaluateOptions = {
  knowledge?: Knowledge;
  /** 事前に作った構成グラフ（省略時はカルテから作る） */
  graph?: Graph;
};

function parentOf(id: string): string {
  return id.split(".")[0] ?? id;
}

/** 型紙の段階に、記事から読み取った段階を割り当てる */
function matchCaseSteps(
  template: Template,
  steps: CaseStep[],
  knowledge: Knowledge,
): Map<string, CaseStep & { technique?: string }> {
  const used = new Set<number>();
  const matched = new Map<string, CaseStep & { technique?: string }>();
  for (const stage of template.stages) {
    const accepted = new Set([
      ...stage.accepts,
      ...Object.values(stage.byRole).filter((t): t is string => t !== null),
    ]);
    const idx = steps.findIndex((s, i) => {
      if (used.has(i) || !stage.tactics.includes(s.tactic)) return false;
      const canon = s.techniques
        .map((t) => canonicalTechnique(t, knowledge.attack))
        .filter((t): t is string => t !== undefined);
      return canon.length === 0 || canon.some((t) => accepted.has(t) || accepted.has(parentOf(t)));
    });
    if (idx < 0) continue;
    used.add(idx);
    const s = steps[idx];
    if (!s) continue;
    const canon = s.techniques
      .map((t) => canonicalTechnique(t, knowledge.attack))
      .filter((t): t is string => t !== undefined);
    const technique =
      canon.find((t) => accepted.has(t)) ??
      canon.find((t) => accepted.has(parentOf(t))) ??
      canon[0];
    matched.set(stage.id, { ...s, ...(technique ? { technique } : {}) });
  }
  return matched;
}

type StageNode = { stage: TemplateStage; node: GraphNode };

/** 一つの入口から列挙する経路の上限（同じ役割の資産が複数あるときの組み合わせ爆発を防ぐ） */
const MAX_SEQUENCES_PER_ENTRY = 8;

/**
 * 入口ノードから型紙の段階を順にたどり、各段階に当たるノードの列を列挙する。
 * - 線（通信エッジ。終点は impacts のエッジも可）に沿ってだけ進む。線のない役割へは飛ばない
 * - 直前のノードから線がつながる段階がなければその段階を飛ばし、後の段階へ線がつながればそこへ進む
 *   （保守ベンダーの遠隔接続のように入口が中核へ直接つながる場合）
 * - 終点（terminal）の段階に到達できない列は返さない（構成上その入口からは進めない）
 * - 同じ役割の資産が複数あれば、それぞれを別の列にする
 */
export function walkStages(template: Template, graph: Graph, entry: GraphNode): StageNode[][] {
  const out: StageNode[][] = [];
  const stages = template.stages;
  const walk = (prev: GraphNode, index: number, acc: StageNode[]): void => {
    if (out.length >= MAX_SEQUENCES_PER_ENTRY) return;
    if (index >= stages.length) {
      if (acc[acc.length - 1]?.stage.terminal) out.push(acc);
      return;
    }
    const stage = stages[index] as TemplateStage;
    if (stage.entry) {
      walk(entry, index + 1, [...acc, { stage, node: entry }]);
      return;
    }
    const roles = Object.keys(stage.byRole);
    const nexts = graph.nodes.filter(
      (n) => roles.includes(n.role) && n.role !== "attacker" && connected(graph, prev.id, n.id),
    );
    if (nexts.length === 0) {
      walk(prev, index + 1, acc);
      return;
    }
    for (const node of nexts) walk(node, index + 1, [...acc, { stage, node }]);
  };
  walk(entry, 0, []);
  return out;
}

function evaluateStageNode(
  { stage, node }: StageNode,
  technique: string | undefined,
  source: PathSource,
  matched: (CaseStep & { technique?: string }) | undefined,
  profile: CompanyProfile,
  knowledge: Knowledge,
  contradictions: Contradiction[],
): PathStep {
  const asset = profile.assets.find((a) => a.id === node.assetId);
  const base = {
    stageId: stage.id,
    nodeId: node.id,
    role: node.role,
    tactic: stage.tactics[0] ?? "TA0001",
    ...(technique ? { technique } : {}),
    source,
    labelJa: stage.labelJa,
    ...(stage.precondition ? { precondition: true } : {}),
    ...(matched?.quote ? { quote: matched.quote } : {}),
  };
  const rule = findRule(knowledge.rules, node.role, technique);
  if (!rule) {
    return {
      ...base,
      mitigations: [],
      ineffective: [],
      state: stage.terminal ? "breached" : "unknown",
      evidence: "none",
      reasonJa: stage.terminal ? "到達" : "判定ルールがありません（未確認として扱います）",
    };
  }
  if (!asset) {
    return {
      ...base,
      mitigations: rule.mitigations,
      ineffective: [],
      state: "breached",
      evidence: "none",
      ruleId: rule.id,
      reasonJa: "到達",
    };
  }
  const r = evaluateRule(rule, asset, contradictions);
  return {
    ...base,
    mitigations: r.mitigations,
    ineffective: r.ineffective,
    state: r.state,
    evidence: r.evidence,
    ruleId: r.ruleId,
    reasonJa: r.reasonJa,
  };
}

/** 段階の列を順に判定し、最初に止まる段階で終える */
export function evaluateSequence(
  stageNodes: StageNode[],
  techniques: (string | undefined)[],
  sources: PathSource[],
  matchedSteps: (CaseStep & { technique?: string })[] | undefined,
  profile: CompanyProfile,
  knowledge: Knowledge,
  contradictions: Contradiction[],
): { steps: PathStep[]; reachedCore: boolean } {
  const steps: PathStep[] = [];
  for (let i = 0; i < stageNodes.length; i++) {
    const sn = stageNodes[i];
    if (!sn) break;
    const step = evaluateStageNode(
      sn,
      techniques[i],
      sources[i] ?? "inferred",
      matchedSteps?.[i],
      profile,
      knowledge,
      contradictions,
    );
    steps.push(step);
    if (step.state === "blocked") return { steps, reachedCore: false };
  }
  const last = stageNodes[stageNodes.length - 1];
  return { steps, reachedCore: !!last?.stage.terminal && steps.length === stageNodes.length };
}

function entryOrder(role: string, knowledge: Knowledge): number {
  const i = knowledge.entryCandidates.candidates.findIndex((c) => c.role === role);
  return i < 0 ? 99 : i;
}

/** 互換用：経路と会社カルテから経営への影響を計算する（本体は impact.ts の computeImpact） */
export function buildImpact(paths: AttackPath[], profile: CompanyProfile): Impact {
  return computeImpact(paths, profile);
}

/** 経路の集合から結論を決める */
export function decideResult(paths: AttackPath[]): VerdictResult {
  const reached = paths.filter((p) => p.reachedCore);
  if (reached.length > 0) {
    // 判定の材料がある段階だけで決める（前提条件、到達、材料のない段階は除く）
    const decisive = (p: AttackPath) =>
      p.steps.filter((s) => !s.precondition && s.mitigations.length > 0 && !isTerminal(p, s));
    const onlyUnknowns = reached.every((p) => {
      const d = decisive(p);
      return (
        d.some((s) => s.state === "unknown") &&
        !d.some((s) => s.state === "breached" || s.state === "human")
      );
    });
    if (onlyUnknowns) return "pending";
    if (reached.every((p) => p.steps.some((s) => s.state === "recoverable"))) return "mitigated";
    return "breached";
  }
  return "blocked";
}
function isTerminal(p: AttackPath, s: PathStep): boolean {
  return p.steps[p.steps.length - 1] === s && p.reachedCore;
}

export function evaluate(
  theCase: Case,
  profile: CompanyProfile,
  options: EvaluateOptions = {},
): Verdict {
  const knowledge = options.knowledge ?? loadKnowledge();
  const graph = options.graph ?? buildGraph(profile, knowledge.roles);
  const contradictions: Contradiction[] = [];
  const empty = (result: VerdictResult): Verdict => ({
    result,
    headlineJa: HEADLINES[result],
    paths: [],
    contradictions,
    timeline: [],
    impact: computeImpact([], profile, { damageType: theCase.damageType, knowledge }),
    attackVersion: knowledge.attack.version,
  });

  const template = knowledge.templates.find((t) => t.damageType === theCase.damageType);
  if (!template || theCase.damageType === "out_of_scope") return empty("out_of_scope");

  const matched = matchCaseSteps(template, theCase.steps, knowledge);
  const entryStage = template.stages.find((s) => s.entry);
  if (!entryStage) return empty("out_of_scope");

  // 入口の候補：型紙の入口の役割のうち、グラフにあり攻撃者とつながっているノード
  const entryNodes = graph.nodes
    .filter((n) => n.role in entryStage.byRole && adjacent(graph, ATTACKER_NODE_ID, n.id))
    .sort((a, b) => entryOrder(a.role, knowledge) - entryOrder(b.role, knowledge));
  if (entryNodes.length === 0) return empty("no_entry");

  // 構成上、終点まで線がつながらない入口（事業者側のホームページなど）は、この攻撃の入口にならない
  const walkable = entryNodes.filter((n) => walkStages(template, graph, n).length > 0);
  if (walkable.length === 0) return empty("no_entry");

  const entryStep = matched.get(entryStage.id);
  const entryKnown =
    entryStep !== undefined && entryStep.source !== "unknown" && theCase.clarity !== "unknown";
  const tech = entryKnown ? entryStep.technique : undefined;
  const fits = entryKnown
    ? walkable.filter((n) => {
        const typical = entryStage.byRole[n.role];
        return (
          tech === undefined ||
          typical === tech ||
          (typical !== null && typical !== undefined && parentOf(typical) === parentOf(tech))
        );
      })
    : [];
  let chosen: { node: GraphNode; source: PathSource; technique?: string }[];
  if (entryKnown && fits.length > 0) {
    chosen = fits.map((node, i) => ({
      node,
      source: i === 0 ? (entryStep.source === "stated" ? "stated" : "inferred") : "candidate",
      ...(tech ? { technique: tech } : {}),
    }));
  } else {
    // 入口が不明、または記事の手法がどの入口の役割にも当たらない：入口候補をすべて展開する
    chosen = walkable.map((node) => ({ node, source: "candidate" }));
  }

  const paths: AttackPath[] = chosen.flatMap(({ node, source, technique }) =>
    walkStages(template, graph, node).map((stageNodes, k) => {
      const techniques = stageNodes.map((sn, i) => {
        if (i === 0) return technique ?? entryStage.byRole[node.role] ?? undefined;
        const m = matched.get(sn.stage.id);
        return m?.technique ?? sn.stage.byRole[sn.node.role] ?? undefined;
      });
      const sources: PathSource[] = stageNodes.map((sn, i) => {
        if (i === 0) return source;
        const m = matched.get(sn.stage.id);
        return m && m.source === "stated" ? "stated" : "inferred";
      });
      const matchedSteps = stageNodes.map((sn, i) =>
        i === 0 ? (source === "candidate" ? undefined : entryStep) : matched.get(sn.stage.id),
      );
      const { steps, reachedCore } = evaluateSequence(
        stageNodes,
        techniques,
        sources,
        matchedSteps as (CaseStep & { technique?: string })[],
        profile,
        knowledge,
        contradictions,
      );
      const reachedAssetIds = steps
        .filter((s) => s.state !== "blocked")
        .map((s) => graph.nodes.find((n) => n.id === s.nodeId)?.assetId)
        .filter((id): id is string => id !== undefined);
      return {
        id: `${template.id}:${node.id}${k > 0 ? `#${k + 1}` : ""}`,
        templateId: template.id,
        source,
        steps,
        reachedCore,
        reachedAssetIds,
      };
    }),
  );

  const result = decideResult(paths);
  const impact = computeImpact(paths, profile, { damageType: theCase.damageType, knowledge });
  const timeline = buildTimeline(
    impact,
    profile,
    { result, paths },
    {
      knowledge,
      damageType: theCase.damageType,
    },
  );
  return {
    result,
    headlineJa: HEADLINES[result],
    paths,
    contradictions: dedupe(contradictions),
    timeline,
    impact,
    attackVersion: knowledge.attack.version,
  };
}

function dedupe(list: Contradiction[]): Contradiction[] {
  const seen = new Set<string>();
  return list.filter((c) => {
    const k = `${c.assetId}|${c.messageJa}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
