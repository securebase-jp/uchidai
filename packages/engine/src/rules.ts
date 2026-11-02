/**
 * 判定ルール表の評価。Claude は使わず、条件式 DSL だけで決定的に判定する
 */
import type { Condition, Rule } from "./knowledge.ts";
import type {
  Asset,
  Contradiction,
  Control,
  EvidenceKind,
  MitigationId,
  StepState,
} from "./types.ts";

const EVIDENCE_RANK: Record<EvidenceKind, number> = {
  external: 3,
  vendor: 2,
  registered: 1,
  none: 0,
};
const STATUS_RANK = { absent: 0, unknown: 1, present: 2 } as const;

export function strongerEvidence(a: EvidenceKind, b: EvidenceKind): EvidenceKind {
  return EVIDENCE_RANK[a] >= EVIDENCE_RANK[b] ? a : b;
}

export type ResolvedControl = { status: Control["status"]; evidence: EvidenceKind; note?: string };

/**
 * 資産の緩和策の状態を決める。同じ緩和策の記録が複数あり食い違えば矛盾として記録し、悪い方で判定する。
 * 「非公開（M1042）」と登録されているのに外部から見える（attrs.exposed が外部確認）場合も矛盾
 */
export function resolveControl(
  asset: Asset,
  mitigation: MitigationId,
  contradictions?: Contradiction[],
): ResolvedControl | undefined {
  const entries = asset.controls.filter((c) => c.mitigation === mitigation);
  if (entries.length === 0) return undefined;
  const sorted = [...entries].sort((a, b) => EVIDENCE_RANK[b.evidence] - EVIDENCE_RANK[a.evidence]);
  const top = sorted[0];
  if (!top) return undefined;
  const disagree = sorted.find((c) => c.status !== top.status);
  let result: ResolvedControl = {
    status: top.status,
    evidence: top.evidence,
    ...(top.noteJa ? { note: top.noteJa } : {}),
  };
  if (disagree) {
    const worst = sorted.reduce(
      (w, c) => (STATUS_RANK[c.status] < STATUS_RANK[w.status] ? c : w),
      top,
    );
    contradictions?.push({
      assetId: asset.id,
      messageJa: `${asset.label} の ${mitigation}：${evidenceLabel(top.evidence)}では「${statusLabel(top.status)}」、${evidenceLabel(disagree.evidence)}では「${statusLabel(disagree.status)}」。悪い方で判定します`,
      external: `${evidenceLabel(top.evidence)}：${statusLabel(top.status)}`,
      registered: `${evidenceLabel(disagree.evidence)}：${statusLabel(disagree.status)}`,
    });
    result = { status: worst.status, evidence: worst.evidence };
  }
  if (
    mitigation === "M1042" &&
    result.status === "present" &&
    asset.attrs.exposed === true &&
    asset.attrEvidence.exposed === "external"
  ) {
    contradictions?.push({
      assetId: asset.id,
      messageJa: `${asset.label} は「非公開」と登録されていますが、外部確認では公開されています。公開ありとして判定します`,
      external: "外部確認：公開あり",
      registered: "担当者登録：非公開",
    });
    result = { status: "absent", evidence: "external" };
  }
  return result;
}

export function statusLabel(s: Control["status"]): string {
  return s === "present" ? "あり" : s === "absent" ? "なし" : "未確認";
}
export function evidenceLabel(e: EvidenceKind): string {
  return e === "external"
    ? "外部確認"
    : e === "vendor"
      ? "ベンダー回答"
      : e === "registered"
        ? "担当者登録"
        : "未確認";
}

type Trace = { evidence: EvidenceKind };

function getAttr(
  asset: Asset,
  key: string,
): { value: string | number | boolean | undefined; evidence: EvidenceKind } {
  if (key === "product")
    return { value: asset.product, evidence: asset.product ? "registered" : "none" };
  if (key === "version")
    return { value: asset.version, evidence: asset.version ? "registered" : "none" };
  const value = asset.attrs[key];
  return {
    value,
    evidence: asset.attrEvidence[key] ?? (value === undefined ? "none" : "registered"),
  };
}

export function evaluateCondition(
  cond: Condition,
  asset: Asset,
  trace: Trace,
  contradictions?: Contradiction[],
): boolean {
  if ("always" in cond) return true;
  if ("all" in cond)
    return cond.all.every((c) => evaluateCondition(c, asset, trace, contradictions));
  if ("any" in cond) {
    // 一致した枝の根拠だけを採る
    for (const c of cond.any) {
      const t: Trace = { evidence: "none" };
      if (evaluateCondition(c, asset, t, contradictions)) {
        trace.evidence = strongerEvidence(trace.evidence, t.evidence);
        return true;
      }
    }
    return false;
  }
  if ("not" in cond)
    return !evaluateCondition(cond.not, asset, { evidence: "none" }, contradictions);
  if ("control" in cond) {
    const r = resolveControl(asset, cond.control.mitigation, contradictions);
    const status = r?.status ?? "unknown";
    if (status === cond.control.status) {
      if (r && status !== "unknown") trace.evidence = strongerEvidence(trace.evidence, r.evidence);
      return true;
    }
    return false;
  }
  const { value, evidence } = getAttr(asset, cond.attr.key);
  if (cond.attr.missing !== undefined) return (value === undefined) === cond.attr.missing;
  if (value === cond.attr.equals) {
    trace.evidence = strongerEvidence(trace.evidence, evidence);
    return true;
  }
  return false;
}

export type RuleResult = {
  state: StepState;
  evidence: EvidenceKind;
  ruleId: string;
  reasonJa: string;
  mitigations: MitigationId[];
  ineffective: { mitigation: MitigationId; reasonJa: string }[];
};

/** ルールを資産に当てて、段階の状態と根拠を返す */
export function evaluateRule(
  rule: Rule,
  asset: Asset,
  contradictions?: Contradiction[],
): RuleResult {
  const ineffective = rule.ineffective
    .filter(
      (i) => !i.when || evaluateCondition(i.when, asset, { evidence: "none" }, contradictions),
    )
    .map((i) => ({ mitigation: i.mitigation, reasonJa: i.reasonJa }));

  for (const outcome of rule.outcomes) {
    const trace: Trace = { evidence: "none" };
    if (outcome.when && !evaluateCondition(outcome.when, asset, trace, contradictions)) continue;
    let evidence = trace.evidence;
    if (!outcome.when) {
      // 既定の結果：ルールの緩和策のうち状態が分かっているものの根拠を採る
      for (const m of rule.mitigations) {
        const r = resolveControl(asset, m);
        if (r && r.status !== "unknown") evidence = strongerEvidence(evidence, r.evidence);
      }
    }
    if (outcome.state === "unknown") evidence = "none";
    return {
      state: outcome.state,
      evidence,
      ruleId: rule.id,
      reasonJa: outcome.reasonJa,
      mitigations: rule.mitigations,
      ineffective,
    };
  }
  const last = rule.outcomes[rule.outcomes.length - 1];
  return {
    state: last?.state ?? "unknown",
    evidence: "none",
    ruleId: rule.id,
    reasonJa: last?.reasonJa ?? "",
    mitigations: rule.mitigations,
    ineffective,
  };
}

function parentOf(id: string): string {
  return id.split(".")[0] ?? id;
}

/** 役割と手法に合うルールを探す。手法が一致するものを優先し、なければ役割の既定ルール（techniques が空） */
export function findRule(rules: Rule[], role: string, technique?: string): Rule | undefined {
  const forRole = rules.filter((r) => r.role === role);
  if (technique) {
    const exact = forRole.find((r) => r.techniques.includes(technique));
    if (exact) return exact;
    const parent = forRole.find((r) =>
      r.techniques.some((t) => parentOf(t) === parentOf(technique)),
    );
    if (parent) return parent;
  }
  return forRole.find((r) => r.techniques.length === 0);
}
