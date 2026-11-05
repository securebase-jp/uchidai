/**
 * 経路の組み立てと判定：型紙 × 構成グラフ × 判定ルール表 → Verdict
 */
import {
  ATTACKER_NODE_ID,
  adjacent,
  buildGraph,
  connected,
  isDefaultFrameProfile,
} from "./graph.ts";
import { computeImpact } from "./impact.ts";
import {
  canonicalTechnique,
  type EntryKindDef,
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

/** 5 問のカルテ（既定の枠だけ）で入口になる資産が見つからないとき：「入口は無い」と断定しない */
export const COVERAGE_GAP_HEADLINE = "カルテの範囲では、この攻撃の入口はありません";
export const COVERAGE_GAP_NOTE =
  "カルテに、この入口になる資産がありません。登録が足りない可能性があります。クラウドの共有設定などを確認してください。";

/** 記事の入口の種類に当たる資産がカルテに登録されていないとき：「入口は無い」とは言わない */
export const entryKindGapHeadline = (kind: Pick<EntryKindDef, "labelJa">): string =>
  `記事の入口（${kind.labelJa}）に当たる資産が、カルテに登録されていません`;
export const entryKindGapNote = (kind: Pick<EntryKindDef, "labelJa">): string =>
  `記事の入口は「${kind.labelJa}」です。御社のカルテには、この入口になる資産が登録されていません。登録が足りない可能性があります。この入口を使っていないか、使っているなら登録して、判定をやり直してください。`;

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
    ...(matched?.entryKind ? { entryKind: matched.entryKind } : {}),
    ...(matched?.certainty && matched.certainty !== "confirmed"
      ? { certainty: matched.certainty }
      : {}),
    ...(matched?.published ? { published: true } : {}),
    labelJa: stage.labelJa,
    ...(stage.sentenceJa ? { sentenceJa: stage.sentenceJa } : {}),
    ...(stage.breachedJa ? { breachedLabelJa: stage.breachedJa } : {}),
    ...(stage.breachedDoneJa ? { breachedDoneJa: stage.breachedDoneJa } : {}),
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
): { paths: AttackPath[]; hasEntry: boolean; missingEntryKind?: EntryKindDef } {
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

  const entryStep = matched.get(entryStage.id);
  const entryKnown =
    entryStep !== undefined && entryStep.source !== "unknown" && theCase.clarity !== "unknown";
  // 記事の入口の種類（VPN・リモートデスクトップ・保守接続など）。手法 ID だけでは見分けられないので、
  // 種類が分かるときは、その種類の資産だけを入口にする。型紙の入口にその種類の役割が無いときは、種類を使わない
  const kindDef = entryKnown
    ? knowledge.entryKinds.find((k) => k.id === entryStep.entryKind)
    : undefined;
  const kind = kindDef && kindDef.roles.some((r) => r in entryStage.byRole) ? kindDef : undefined;
  const kindNodes = kind ? walkable.filter((n) => kind.roles.includes(n.role)) : [];
  // 一致する種類の資産がカルテに無い：別の入口の候補（VPN、フィッシングなど）に切り替えず、「未登録」と答える
  if (kind && kindNodes.length === 0) return { paths: [], hasEntry: false, missingEntryKind: kind };
  if (walkable.length === 0) return { paths: [], hasEntry: false };
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
  if (kind) {
    // 種類が一致する資産だけを入口にする。手法は、記事の手法のうちその資産に当たるもの（無ければ型紙の典型手法）
    chosen = kindNodes.map((node, i) => {
      const technique = canon.find((t) => entryFits(node, entryStage, t, knowledge));
      return {
        node,
        // 入口が絞れない種類（正規の認証情報だけ）は、どの資産も「記載」とは言わず、候補として並べる
        source:
          kind.pinsAsset && i === 0
            ? entryStep?.source === "stated"
              ? "stated"
              : "inferred"
            : "candidate",
        ...(technique ? { technique } : {}),
      };
    });
  } else if (entryKnown && fits.length > 0) {
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

const dateOf = (v: unknown): string | undefined =>
  typeof v === "string" && v.length >= 10 ? v.slice(0, 10) : undefined;

/**
 * カルテの属性だけから分かる矛盾（経路の判定に依らず、判定のたびに同じ結果になる）：
 * 廃止済み（attrs.decommissioned）と登録された資産に、外部確認が「ホスト名が外部に残っている」
 * （attrs.externallySeen = true、根拠 external。recon の applyAssetHints が付ける）と記していれば矛盾。
 * 担当者が手で externallySeen を付けても根拠が external でなければ出さない
 */
export function profileContradictions(profile: CompanyProfile): Contradiction[] {
  const out: Contradiction[] = [];
  for (const asset of profile.assets) {
    if (asset.attrs.decommissioned !== true) continue;
    if (asset.attrs.externallySeen !== true || asset.attrEvidence.externallySeen !== "external")
      continue;
    const hostname = typeof asset.attrs.hostname === "string" ? asset.attrs.hostname : undefined;
    const seenAt = dateOf(asset.attrs.externallySeenAt);
    const expiry = dateOf(asset.attrs.lastCertExpiry);
    out.push({
      assetId: asset.id,
      messageJa: "カルテで廃止済みだが、外部にホスト名が残っている可能性",
      external: `外部確認：ホスト名${hostname ? ` ${hostname}` : ""} が DNS または証明書の公開ログに残っている${seenAt ? `（${seenAt} 時点）` : ""}${expiry ? `。最後の証明書の期限 ${expiry}` : ""}`,
      registered: "担当者登録：廃止済み（attrs.decommissioned = true）",
    });
  }
  return out;
}

/** ソフトウェアの供給網の事故（配布元・更新の悪用）か。対象外の事故のうち、利用者が確認できることがあるもの */
function isSupplyChain(theCase: Case): boolean {
  return theCase.steps.some((s) => s.techniques.some((t) => /^T1195|^T1608/.test(t)));
}
export const SUPPLY_CHAIN_HEADLINE =
  "ソフトウェアの供給網の事故です。御社の設備が入口かどうかは、この判定では扱いません（対象外）";
function supplyChainGuidance(theCase: Case): string[] {
  return [
    "これは、ソフトウェアの配布元や更新の仕組みが悪用された事故（供給網の攻撃）です。御社の設備に入口があるかどうかは、この判定では扱いません。",
    "記事に書かれた、影響を受けた版・入手元・期間を確認し、その期間に取得・更新・利用した端末が御社にないかを確かめてください。",
    "該当する端末があれば、配布元の案内に従って更新を止め、署名やハッシュの確認と、感染を疑う場合の端末の隔離を検討してください。",
    ...(theCase.url ? [`出典：${theCase.url}`] : []),
  ];
}

/**
 * 判定の対象外の事故のとき、判定は出さず、固定の文を出す（D-006、B-002）：
 * 個人情報が外部の人に見られた可能性があれば報告が必要になることがある、と共通の初動（knowledge/first-actions.yaml）
 */
export function outOfScopeGuidance(theCase: Case, knowledge: Knowledge): string[] {
  const techniques = theCase.steps.flatMap((s) => s.techniques);
  const matched = knowledge.firstActions.byTechnique.filter((a) =>
    a.techniques.some((prefix) => techniques.some((t) => t.startsWith(prefix))),
  );
  return [
    "この事故は攻撃経路で判定できないため、被害の見込みは出していません。",
    "攻撃経路は判定できませんが、個人情報が外部の人に見られた可能性がある場合は、個人情報保護委員会への報告が必要になることがあります。",
    ...knowledge.firstActions.common,
    ...matched.flatMap((a) => a.actionsJa),
  ];
}

/** 第三者（委託先・取引先・提供元）の事故の見出し：御社の設備が入口になったとは言わず、「御社が同じ立場なら」の見立てとして書く */
const THIRD_PARTY_TAIL: Partial<Record<VerdictResult, string>> = {
  blocked: "止められます",
  mitigated: "侵入は防げませんが、被害は抑えられます",
  breached: "大丈夫ではありません",
  pending: "確認中です（未確認の項目が残っています）",
};
export const thirdPartyHeadline = (labelJa: string, result: VerdictResult): string | undefined =>
  THIRD_PARTY_TAIL[result] === undefined
    ? undefined
    : `これは${labelJa}で起きた事故です。御社が同じ立場なら、${THIRD_PARTY_TAIL[result]}`;

/**
 * 被害が第三者（委託先・取引先・提供元）に起きた事故のとき、結論に印と、御社が確認することを添える。
 * 判定そのものは変えない（御社が同じ立場だったらどうなるか）。経路があるときは、見出しも第三者の事故として書き直す
 */
function applyThirdParty(v: Verdict, theCase: Case, knowledge: Knowledge): Verdict {
  const def = knowledge.victims.find((x) => x.id === theCase.victim);
  if (!def?.thirdParty || v.result === "out_of_scope") return v;
  const sub = (s: string) => s.replaceAll("{label}", def.labelJa);
  const headline = v.paths.length > 0 ? thirdPartyHeadline(def.labelJa, v.result) : undefined;
  return {
    ...v,
    ...(headline ? { headlineJa: headline } : {}),
    thirdParty: {
      id: def.id,
      labelJa: def.labelJa,
      checksJa: def.checksJa.map(sub),
      ...(def.reportNoteJa ? { reportNoteJa: sub(def.reportNoteJa) } : {}),
      measureIds: def.measureIds,
    },
  };
}

/**
 * 記事が書く事実（被害額、未遂）を結論に載せる（B-003、B-013）。未遂のときは、見出しも
 * 「記事の会社は被害を防げた事例です。同じ手口が御社に来たら、…」にする（第三者の事故の見出しを優先する）
 */
function applyArticleFacts(v: Verdict, theCase: Case): Verdict {
  if (theCase.reportedLossJpy === undefined && !theCase.averted) return v;
  const headline =
    theCase.averted && !v.thirdParty && v.paths.length > 0 ? avertedHeadline(v.result) : undefined;
  return {
    ...v,
    ...(headline ? { headlineJa: headline } : {}),
    article: {
      ...(theCase.reportedLossJpy !== undefined
        ? { reportedLossJpy: theCase.reportedLossJpy }
        : {}),
      ...(theCase.averted ? { averted: true } : {}),
    },
  };
}
export const avertedHeadline = (result: VerdictResult): string | undefined =>
  THIRD_PARTY_TAIL[result] === undefined
    ? undefined
    : `記事の会社は被害を防げた事例です。同じ手口が御社に来たら、${THIRD_PARTY_TAIL[result]}`;

/** 記事が書く漏えいした情報の種類（定義済みのもの）を、案内つきで結論に載せる（D-011） */
function applyLeakedData(v: Verdict, theCase: Case, knowledge: Knowledge): Verdict {
  const kinds = (theCase.leakedData ?? [])
    .map((id) => knowledge.leakKinds.find((k) => k.id === id))
    .filter((k): k is NonNullable<typeof k> => k !== undefined);
  if (kinds.length === 0) return v;
  return {
    ...v,
    leakedData: kinds.map((k) => ({ id: k.id, labelJa: k.labelJa, noteJa: k.noteJa })),
  };
}

export function evaluate(
  theCase: Case,
  profile: CompanyProfile,
  options: EvaluateOptions = {},
): Verdict {
  const knowledge = options.knowledge ?? loadKnowledge();
  return applyArticleFacts(
    applyLeakedData(
      applyThirdParty(
        evaluateCore(theCase, profile, { ...options, knowledge }),
        theCase,
        knowledge,
      ),
      theCase,
      knowledge,
    ),
    theCase,
  );
}

function evaluateCore(
  theCase: Case,
  profile: CompanyProfile,
  options: EvaluateOptions & { knowledge: Knowledge },
): Verdict {
  const knowledge = options.knowledge;
  const graph = options.graph ?? buildGraph(profile, knowledge.roles);
  // 経路の判定で見つかる矛盾（resolveControl）の前に、カルテの属性だけから分かる矛盾を積む
  const contradictions: Contradiction[] = profileContradictions(profile);
  const selected = theCase.damageType === "out_of_scope" ? [] : selectTemplates(theCase, knowledge);
  // 型紙を 1 本に絞れたときだけ Verdict に載せる（複数を展開したときは各経路の templateId を見る）
  const single = selected.length === 1 ? selected[0]?.template : undefined;
  const templateFields = single ? { templateId: single.id, templateLabelJa: single.labelJa } : {};
  const empty = (result: VerdictResult, headlineJa?: string, coverageGapJa?: string): Verdict => ({
    result,
    headlineJa: headlineJa ?? HEADLINES[result],
    ...templateFields,
    ...(coverageGapJa ? { coverageGapJa } : {}),
    paths: [],
    contradictions,
    timeline: [],
    impact: computeImpact([], profile, { damageType: theCase.damageType, knowledge }),
    attackVersion: knowledge.attack.version,
  });

  const top = selected[0];
  if (!top) {
    // 対象外でも、ソフトウェアの供給網の事故なら、利用者が確認できることを案内する（判定は出さない）
    if (theCase.damageType === "out_of_scope" && isSupplyChain(theCase))
      return {
        ...empty("out_of_scope", SUPPLY_CHAIN_HEADLINE),
        guidanceJa: supplyChainGuidance(theCase),
      };
    return { ...empty("out_of_scope"), guidanceJa: outOfScopeGuidance(theCase, knowledge) };
  }

  // 記事の段階のどれも型紙の手法に対応づけられないなら、どの型紙もこの記事の攻撃を表していない。
  // 手法の無い段階を戦術だけで当てはめて「止められます」と答えると、誤って安心を与えるので判定しない。
  // 入口が分からない記事（clarity: unknown）は、仕様どおり入口の候補をすべて展開する
  if (theCase.clarity !== "unknown" && theCase.steps.length > 0 && top.stageMatches === 0) {
    return {
      ...empty("out_of_scope", UNMAPPED_HEADLINE),
      guidanceJa: outOfScopeGuidance(theCase, knowledge),
    };
  }

  const paths: AttackPath[] = [];
  let hasEntry = false;
  let missingEntryKind: EntryKindDef | undefined;
  for (const m of selected) {
    const r = pathsForTemplate(m, theCase, profile, graph, knowledge, contradictions);
    paths.push(...r.paths);
    hasEntry ||= r.hasEntry;
    missingEntryKind ??= r.missingEntryKind;
  }
  if (!hasEntry && missingEntryKind) {
    // 記事の入口の種類に当たる資産がカルテに無い。「入口は無い」と断定せず、登録の不足として答える
    const note = entryKindGapNote(missingEntryKind);
    return isDefaultFrameProfile(profile, knowledge.patterns, knowledge.sites)
      ? empty("pending", entryKindGapHeadline(missingEntryKind), note)
      : empty("no_entry", entryKindGapHeadline(missingEntryKind), note);
  }
  if (!hasEntry) {
    // 既定の枠だけのカルテは、クラウドの共有設定などを持たない。入口の資産が無いのは「登録が足りない」かもしれず、
    // 「御社に入口は無い」と断定すると誤って安心させる。詳細に作り込んだカルテでの「入口なし」は変えない
    if (isDefaultFrameProfile(profile, knowledge.patterns, knowledge.sites))
      return empty("pending", COVERAGE_GAP_HEADLINE, COVERAGE_GAP_NOTE);
    return empty("no_entry");
  }

  const result = decideResult(paths);
  const impact = computeImpact(paths, profile, { damageType: theCase.damageType, knowledge });
  const timeline = buildTimeline(
    impact,
    profile,
    { result, paths },
    {
      knowledge,
      damageType: theCase.damageType,
      ...(theCase.leakedData ? { leakedKinds: theCase.leakedData } : {}),
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
