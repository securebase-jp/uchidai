import type { CaseOutput, CaseStep, GoldCase, GoldStep, Recording } from "./types.ts";

export type CaseScore = {
  caseId: string;
  mode: Recording["mode"];
  /** 正解の攻撃段階を漏れなく取り出せたか（戦術単位の再現率） */
  stageRecall: number;
  /** 一致した段階のうち、記載／推定の区別が合っていた割合 */
  sourceAccuracy: number;
  /** 手法IDの一致（完全一致 1.0、親手法のみ一致 0.75、戦術のみ一致 0.5） */
  techniqueScore: number;
  /** 根拠文が原文に実在し、その段階を支えているか。原文がなければ null */
  quoteScore: number | null;
  /** 最終判定の一致。判定が未記録なら null */
  verdictMatch: number | null;
  /** null を除いた平均 */
  overall: number;
  matchedStages: number;
  totalStages: number;
};

/** 空白と全角半角の揺れを吸収して照合する */
export function normalizeText(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .replace(/[「」『』“”"'、。．，,.]/g, "");
}

function parentOf(id: string): string {
  return id.split(".")[0] ?? id;
}

function techniqueMatch(gold: GoldStep, actual: CaseStep): number {
  const goldIds = new Set(gold.techniques);
  if (actual.techniques.some((t) => goldIds.has(t))) return 1;
  const goldParents = new Set(gold.techniques.map(parentOf));
  if (actual.techniques.some((t) => goldParents.has(parentOf(t)))) return 0.75;
  return 0.5; // 戦術は一致している
}

/**
 * 正解の段階を順に辿り、同じ戦術の未使用の出力段階を割り当てる。
 * 同じ戦術の候補が複数あるときは、手法が一致するもの → 親手法が一致するもの → 先頭 の順に選ぶ
 * （出力の並び順の違いで、バックアップ破壊と暗号化のような同一戦術の段階が入れ違いに採点されないようにする）
 */
export function matchSteps(gold: GoldStep[], actual: CaseStep[]): (CaseStep | undefined)[] {
  const used = new Set<number>();
  return gold.map((g) => {
    const candidates = actual
      .map((a, i) => ({ a, i }))
      .filter(({ a, i }) => !used.has(i) && a.tactic === g.tactic);
    if (candidates.length === 0) return undefined;
    const best =
      candidates.reduce<{ a: CaseStep; i: number; score: number } | undefined>((acc, c) => {
        const score = techniqueMatch(g, c.a);
        return acc === undefined || score > acc.score ? { ...c, score } : acc;
      }, undefined) ?? candidates[0];
    if (!best) return undefined;
    used.add(best.i);
    return best.a;
  });
}

export function quoteSupports(actual: CaseStep, gold: GoldStep, articleText: string): number {
  if (!actual.quote) return 0;
  const text = normalizeText(articleText);
  const q = normalizeText(actual.quote);
  if (q.length < 8 || !text.includes(q)) return 0;
  if (!gold.quoteHint) return 1;
  const hint = normalizeText(gold.quoteHint);
  return q.includes(hint) || hint.includes(q) ? 1 : 0;
}

export function scoreCase(
  gold: GoldCase,
  rec: Recording,
  opts: { articleText?: string } = {},
): CaseScore {
  const output: CaseOutput = rec.output;
  const goldSteps = gold.expected.steps;
  const matched = matchSteps(goldSteps, output.steps);
  const pairs = goldSteps
    .map((g, i) => ({ g, a: matched[i] }))
    .filter((p): p is { g: GoldStep; a: CaseStep } => p.a !== undefined);

  const totalStages = goldSteps.length;
  const matchedStages = pairs.length;
  const stageRecall = totalStages === 0 ? 1 : matchedStages / totalStages;
  const sourceAccuracy =
    matchedStages === 0 ? 0 : pairs.filter((p) => p.a.source === p.g.source).length / matchedStages;
  const techniqueScore =
    totalStages === 0
      ? 1
      : pairs.reduce((sum, p) => sum + techniqueMatch(p.g, p.a), 0) / totalStages;

  let quoteScore: number | null = null;
  if (opts.articleText !== undefined) {
    const stated = pairs.filter((p) => p.a.source === "stated");
    quoteScore =
      stated.length === 0
        ? 0
        : stated.reduce((sum, p) => sum + quoteSupports(p.a, p.g, opts.articleText ?? ""), 0) /
          stated.length;
  }

  let verdictMatch: number | null = null;
  if (rec.verdict !== undefined && gold.expected.verdict !== undefined) {
    verdictMatch = rec.verdict === gold.expected.verdict ? 1 : 0;
  }

  const parts = [stageRecall, sourceAccuracy, techniqueScore, quoteScore, verdictMatch].filter(
    (v): v is number => v !== null,
  );
  const overall = parts.reduce((a, b) => a + b, 0) / parts.length;

  return {
    caseId: gold.id,
    mode: rec.mode,
    stageRecall,
    sourceAccuracy,
    techniqueScore,
    quoteScore,
    verdictMatch,
    overall,
    matchedStages,
    totalStages,
  };
}
