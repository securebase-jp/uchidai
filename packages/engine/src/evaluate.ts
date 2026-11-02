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

/** 記事の攻撃が型紙の手法に対応づけられず、判定できないときの文言 */
export const UNMAPPED_HEADLINE =
  "この記事の攻撃は、ウチダイの型紙の手法に対応づけられないため、判定できません（対象外）";

export type EvaluateOptions = {
  knowledge?: Knowledge;
  /** 事前に作った構成グラフ（省略時はカルテから作る） */
  graph?: Graph;
};

function parentOf(id: string): string {
  return id.split(".")[0] ?? id;
}

/**
 * 型紙の段階に、記事から読み取った段階を割り当てる。
 * 戦術が一致し、手法が段階の典型手法（byRole）か accepts にある段階を先に割り当て、
 * 手法の無い段階（入口不明や、検証で手法がすべて型紙外として落ちた段階）は、残った段階に戦術だけで当てる。
 * 手法の無い段階を先に当ててしまうと、「暗号化」の段階が「バックアップを消す」に取られるなど、入れ違いが起きる
 */
export function matchCaseSteps(
  template: Template,
  steps: CaseStep[],
  knowledge: Knowledge,
): Map<string, CaseStep & { technique?: string }> {
  const used = new Set<number>();
  const matched = new Map<string, CaseStep & { technique?: string }>();
  const canonOf = (s: CaseStep) =>
    s.techniques
      .map((t) => canonicalTechnique(t, knowledge.attack))
      .filter((t): t is string => t !== undefined);
  const acceptedOf = (stage: TemplateStage) =>
    new Set([
      ...stage.accepts,
      ...Object.values(stage.byRole).filter((t): t is string => t !== null),
    ]);
  const pick = (stage: TemplateStage, pass: "technique" | "tactic") => {
    const accepted = acceptedOf(stage);
    const idx = steps.findIndex((s, i) => {
      if (used.has(i) || !stage.tactics.includes(s.tactic)) return false;
      const canon = canonOf(s);
      if (pass === "tactic") return canon.length === 0;
      return canon.some((t) => accepted.has(t) || accepted.has(parentOf(t)));
    });
    if (idx < 0) return;
    used.add(idx);
    const s = steps[idx];
    if (!s) return;
    const canon = canonOf(s);
    const technique =
      canon.find((t) => accepted.has(t)) ??
      canon.find((t) => accepted.has(parentOf(t))) ??
      canon[0];
    matched.set(stage.id, { ...s, ...(technique ? { technique } : {}) });
  };
  for (const stage of template.stages) pick(stage, "technique");
  for (const stage of template.stages) if (!matched.has(stage.id)) pick(stage, "tactic");
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
 * - 直前のノードの役割がその段階の役割に含まれるなら、同じノードで続ける（社長のアカウントで乗っ取り→なりすまし、
 *   サーバで横展開→収集→持ち出し）。別の資産へ分岐させると同じ経路の組み合わせが増えるだけ
 * - options.skip の段階は飛ばす（記事に対応づかなかった枝の段階）
 */
export function walkStages(
  template: Template,
  graph: Graph,
  entry: GraphNode,
  options: { skip?: ReadonlySet<string> } = {},
): StageNode[][] {
  const out: StageNode[][] = [];
  const stages = template.stages;
  const walk = (prev: GraphNode, index: number, acc: StageNode[]): void => {
    if (out.length >= MAX_SEQUENCES_PER_ENTRY) return;
    if (index >= stages.length) {
      if (acc[acc.length - 1]?.stage.terminal) out.push(acc);
      return;
    }
    const stage = stages[index] as TemplateStage;
    if (options.skip?.has(stage.id)) {
      walk(prev, index + 1, acc);
      return;
    }
    if (stage.entry) {
      walk(entry, index + 1, [...acc, { stage, node: entry }]);
      return;
    }
    const roles = Object.keys(stage.byRole);
    const nexts = roles.includes(prev.role)
      ? [prev]
      : graph.nodes.filter(
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
    ...(stage.branch ? { branch: true } : {}),
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
    // 枝の段階（持ち出しなど）が止まっても本線は進む。本線の段階が止まればそこで終える
    if (step.state === "blocked" && !sn.stage.branch) return { steps, reachedCore: false };
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
    // 判定の材料がある本線の段階だけで決める（前提条件、枝、到達、材料のない段階は除く）。
    // 枝（持ち出しなど）は本線が中核に届くかどうかを左右しないので、枝だけが赤でも「大丈夫ではない」にはしない
    const decisive = (p: AttackPath) =>
      p.steps.filter(
        (s) => !s.precondition && !s.branch && s.mitigations.length > 0 && !isTerminal(p, s),
      );
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

// ---------------------------------------------------------------------------
// 型紙の選択（被害の型ごとに複数の型紙がある）
// ---------------------------------------------------------------------------
export type TemplateMatch = {
  template: Template;
  matched: Map<string, CaseStep & { technique?: string }>;
  /** 手法まで対応づいた段階の数 */
  stageMatches: number;
  /** 記事の手法のうち、型紙のどこかの段階（典型手法か accepts）に当たる数 */
  techniqueMatches: number;
};

/**
 * 被害の型の型紙を、記事への当てはまりの順に並べる。
 * 手法まで対応づいた段階が多い型紙 → 記事の手法の一致が多い型紙 → YAML の priority が大きい型紙 → 読み込み順
 */
export function rankTemplates(theCase: Case, knowledge: Knowledge): TemplateMatch[] {
  const canon = new Set(
    theCase.steps.flatMap((s) =>
      s.techniques
        .map((t) => canonicalTechnique(t, knowledge.attack))
        .filter((t): t is string => t !== undefined),
    ),
  );
  const ranked = knowledge.templates
    .map((template, index) => {
      const accepted = new Set(
        template.stages.flatMap((s) => [
          ...s.accepts,
          ...Object.values(s.byRole).filter((t): t is string => t !== null),
        ]),
      );
      const matched = matchCaseSteps(template, theCase.steps, knowledge);
      return {
        template,
        matched,
        stageMatches: [...matched.values()].filter((m) => m.technique !== undefined).length,
        techniqueMatches: [...canon].filter((t) => accepted.has(t) || accepted.has(parentOf(t)))
          .length,
        index,
      };
    })
    .filter((m) => m.template.damageType === theCase.damageType)
    .sort(
      (a, b) =>
        b.stageMatches - a.stageMatches ||
        b.techniqueMatches - a.techniqueMatches ||
        b.template.priority - a.template.priority ||
        a.index - b.index,
    );
  return ranked.map(({ index: _index, ...m }) => m);
}

/**
 * 判定に使う型紙。ふつうは最も当てはまる 1 本。
 * 入口が不明な記事（clarity: unknown）で当てはまりが同じ型紙が複数あれば、それぞれの入口候補を全部展開する
 */
export function selectTemplates(theCase: Case, knowledge: Knowledge): TemplateMatch[] {
  const ranked = rankTemplates(theCase, knowledge);
  const top = ranked[0];
  if (!top) return [];
  if (theCase.clarity !== "unknown") return [top];
  return ranked.filter(
    (m) => m.stageMatches === top.stageMatches && m.techniqueMatches === top.techniqueMatches,
  );
}

/** 廃止済みと登録された資産（旧キャンペーンサイトなど）は、攻撃の入口に数えない */
function isDecommissioned(node: GraphNode, profile: CompanyProfile): boolean {
  const asset = profile.assets.find((a) => a.id === node.assetId);
  return asset?.attrs.decommissioned === true;
}

/** 役割にその手法を明示的に判定するルール（手法を問わない既定ルールは除く）があるか */
function hasExplicitRule(knowledge: Knowledge, role: string, technique: string): boolean {
  const rule = findRule(knowledge.rules, role, technique);
  return rule !== undefined && rule.techniques.length > 0;
}

/**
 * 記事の入口の手法が、その入口の役割に当たるか。
 * 型紙の典型手法（またはその親が同じ兄弟手法）か、役割にその手法を判定するルールがあるもの（VPN × T1133 など）
 */
function entryFits(
  node: GraphNode,
  entryStage: TemplateStage,
  technique: string,
  knowledge: Knowledge,
): boolean {
  const typical = entryStage.byRole[node.role];
  if (typical && (typical === technique || parentOf(typical) === parentOf(technique))) return true;
  return hasExplicitRule(knowledge, node.role, technique);
}

/**
 * 記事の入口の手法（読解が挙げた順）のうち、いずれかの入口に当たる最初の手法と、当たる入口の一覧。
 * どの手法もどの入口にも当たらなければ空（入口候補をすべて展開する）
 */
function fitEntries(
  walkable: GraphNode[],
  entryStage: TemplateStage,
  canon: string[],
  knowledge: Knowledge,
): { node: GraphNode; technique: string }[] {
  for (const technique of canon) {
    const nodes = walkable.filter((n) => entryFits(n, entryStage, technique, knowledge));
    if (nodes.length > 0) return nodes.map((node) => ({ node, technique }));
  }
  return [];
}

/** 一本の型紙を構成グラフに当てて経路を作る。入口が無ければ空 */
function pathsForTemplate(
  { template, matched }: TemplateMatch,
  theCase: Case,
  profile: CompanyProfile,
  graph: Graph,
  knowledge: Knowledge,
  contradictions: Contradiction[],
): { paths: AttackPath[]; hasEntry: boolean } {
  const entryStage = template.stages.find((s) => s.entry);
  if (!entryStage) return { paths: [], hasEntry: false };

  // 枝の段階（持ち出しなど）は、記事に対応づいたときだけ経路に入れる
  const skip = new Set(
    template.stages.filter((s) => s.branch && !matched.has(s.id)).map((s) => s.id),
  );

  // 入口の候補：型紙の入口の役割のうち、グラフにあり攻撃者とつながっていて、廃止されていないノード
  const entryNodes = graph.nodes
    .filter(
      (n) =>
        n.role in entryStage.byRole &&
        adjacent(graph, ATTACKER_NODE_ID, n.id) &&
        !isDecommissioned(n, profile),
    )
    .sort((a, b) => entryOrder(a.role, knowledge) - entryOrder(b.role, knowledge));
  // 構成上、終点まで線がつながらない入口（事業者側のホームページなど）は、この攻撃の入口にならない
  const walkable = entryNodes.filter((n) => walkStages(template, graph, n, { skip }).length > 0);
  if (walkable.length === 0) return { paths: [], hasEntry: false };

  const entryStep = matched.get(entryStage.id);
  const entryKnown =
    entryStep !== undefined && entryStep.source !== "unknown" && theCase.clarity !== "unknown";
  const canon = entryKnown
    ? entryStep.techniques
        .map((t) => canonicalTechnique(t, knowledge.attack))
        .filter((t): t is string => t !== undefined)
    : [];
  const fits: { node: GraphNode; technique?: string }[] = !entryKnown
    ? []
    : canon.length === 0
      ? walkable.map((node) => ({ node }))
      : fitEntries(walkable, entryStage, canon, knowledge);
  let chosen: { node: GraphNode; source: PathSource; technique?: string }[];
  if (entryKnown && fits.length > 0) {
    chosen = fits.map(({ node, technique }, i) => ({
      node,
      source: i === 0 ? (entryStep.source === "stated" ? "stated" : "inferred") : "candidate",
      ...(technique ? { technique } : {}),
    }));
  } else {
    // 入口が不明、または記事の手法がどの入口の役割にも当たらない：入口候補をすべて展開する
    chosen = walkable.map((node) => ({ node, source: "candidate" }));
  }

  const paths: AttackPath[] = chosen.flatMap(({ node, source, technique }) =>
    walkStages(template, graph, node, { skip }).map((stageNodes, k) => {
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
  return { paths, hasEntry: true };
}

export function evaluate(
  theCase: Case,
  profile: CompanyProfile,
  options: EvaluateOptions = {},
): Verdict {
  const knowledge = options.knowledge ?? loadKnowledge();
  const graph = options.graph ?? buildGraph(profile, knowledge.roles);
  const contradictions: Contradiction[] = [];
  const selected = theCase.damageType === "out_of_scope" ? [] : selectTemplates(theCase, knowledge);
  // 型紙を 1 本に絞れたときだけ Verdict に載せる（複数を展開したときは各経路の templateId を見る）
  const single = selected.length === 1 ? selected[0]?.template : undefined;
  const templateFields = single ? { templateId: single.id, templateLabelJa: single.labelJa } : {};
  const empty = (result: VerdictResult, headlineJa?: string): Verdict => ({
    result,
    headlineJa: headlineJa ?? HEADLINES[result],
    ...templateFields,
    paths: [],
    contradictions,
    timeline: [],
    impact: computeImpact([], profile, { damageType: theCase.damageType, knowledge }),
    attackVersion: knowledge.attack.version,
  });

  const top = selected[0];
  if (!top) return empty("out_of_scope");

  // 記事の段階のどれも型紙の手法に対応づけられないなら、どの型紙もこの記事の攻撃を表していない。
  // 手法の無い段階を戦術だけで当てはめて「止められます」と答えると、誤って安心を与えるので判定しない。
  // 入口が分からない記事（clarity: unknown）は、仕様どおり入口の候補をすべて展開する
  if (theCase.clarity !== "unknown" && theCase.steps.length > 0 && top.stageMatches === 0) {
    return empty("out_of_scope", UNMAPPED_HEADLINE);
  }

  const paths: AttackPath[] = [];
  let hasEntry = false;
  for (const m of selected) {
    const r = pathsForTemplate(m, theCase, profile, graph, knowledge, contradictions);
    paths.push(...r.paths);
    hasEntry ||= r.hasEntry;
  }
  if (!hasEntry) return empty("no_entry");

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
    ...templateFields,
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
