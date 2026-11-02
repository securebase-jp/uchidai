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

/** 一つの戦術の中で、正解の段階と出力の段階の対応を全組み合わせから選ぶ（手法の点の合計 → 区別の一致数の順に最大化） */
function assignWithinTactic(
  gold: { g: GoldStep; gi: number }[],
  actual: { a: CaseStep; ai: number }[],
): Map<number, number> {
  const n = Math.min(gold.length, actual.length);
  let best: { map: Map<number, number>; technique: number; source: number } | undefined;
  const consider = (map: Map<number, number>) => {
    let technique = 0;
    let source = 0;
    for (const [gi, ai] of map) {
      const g = gold.find((x) => x.gi === gi)?.g;
      const a = actual.find((x) => x.ai === ai)?.a;
      if (!g || !a) continue;
      technique += techniqueMatch(g, a);
      if (g.source === a.source) source += 1;
    }
    if (
      !best ||
      technique > best.technique ||
      (technique === best.technique && source > best.source)
    )
      best = { map, technique, source };
  };
  // 正解の段階の並び順を固定し、出力の段階の選び方（順列）を全部試す。段階数は小さいので総当たりで足りる
  const chosen: number[] = [];
  const used = new Set<number>();
  const rec = (depth: number) => {
    if (depth === gold.length) {
      const map = new Map<number, number>();
      chosen.forEach((ai, i) => {
        if (ai >= 0) map.set(gold[i]?.gi ?? -1, ai);
      });
      consider(map);
      return;
    }
    // 出力が足りないときは、どの正解の段階を未対応にするかも試す
    if (used.size === actual.length || gold.length - depth > n - used.size) {
      chosen.push(-1);
      rec(depth + 1);
      chosen.pop();
      if (used.size === actual.length) return;
    }
    for (const { ai } of actual) {
      if (used.has(ai)) continue;
      used.add(ai);
      chosen.push(ai);
      rec(depth + 1);
      chosen.pop();
      used.delete(ai);
    }
  };
  if (gold.length <= 5) rec(0);
  else {
    // 念のため：段階が多すぎるときは貪欲（手法が一致するもの → 先頭）
    const map = new Map<number, number>();
    for (const { g, gi } of gold) {
      const cand = actual
        .filter(({ ai }) => ![...map.values()].includes(ai))
        .sort((x, y) => techniqueMatch(g, y.a) - techniqueMatch(g, x.a))[0];
      if (cand) map.set(gi, cand.ai);
    }
    consider(map);
  }
  return best?.map ?? new Map();
}

/**
 * 正解の段階に、同じ戦術の出力段階を割り当てる（同じ出力段階は二度使わない）。
 * 同じ戦術の候補が複数あるときは、戦術ごとに全組み合わせを試して手法の点の合計が最大になる対応を選ぶ
 * （正解 A が [T1021, T1021.002]、B が [T1021.002] のとき、貪欲に A に T1021.002 を渡すと B が損をする、
 *  バックアップ破壊と暗号化のような同一戦術の段階が入れ違いに採点される、といった取りこぼしを防ぐ）
 */
export function matchSteps(gold: GoldStep[], actual: CaseStep[]): (CaseStep | undefined)[] {
  const result: (CaseStep | undefined)[] = gold.map(() => undefined);
  const tactics = [...new Set(gold.map((g) => g.tactic))];
  for (const tactic of tactics) {
    const gs = gold.map((g, gi) => ({ g, gi })).filter((x) => x.g.tactic === tactic);
    const as = actual.map((a, ai) => ({ a, ai })).filter((x) => x.a.tactic === tactic);
    for (const [gi, ai] of assignWithinTactic(gs, as)) result[gi] = actual[ai];
  }
  return result;
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
