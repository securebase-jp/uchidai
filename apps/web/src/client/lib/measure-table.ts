/**
 * 「対策 × 段階」の表の材料。判定はしない（判定済みの経路の段階を読んで、列と印と費用の棒を作るだけ）。
 * 行の効き目の分類は MeasurePanel の measureEffect と同じ規則（同じ役割の段階だけを見る）
 */
import type { Graph, MeasureDef, PathStep, Verdict } from "./types.ts";

export type MeasureCol = {
  key: string;
  /** 列の短い名前（構成要素の名前。複数の経路で別の要素に当たるときは型紙の段階の見出し） */
  label: string;
  /** 型紙の段階の見出し（読み上げと吹き出し用） */
  stageJa?: string;
};

/** 表のセルの印：効く（●）、効かない（×。理由つき）。関係しないときは無し */
export type CellMark = { kind: "effective" } | { kind: "ineffective"; reasonJa: string };

const keyOf = (s: PathStep): string => s.stageId ?? s.nodeId;

/** 対策ボタンの判定に数える段階（AI の経路は数えない） */
const stepsOf = (v: Verdict): PathStep[] =>
  v.paths.filter((p) => p.source !== "ai").flatMap((p) => p.steps);

/** 1 つの対策が、同じ列の段階たちに効くか・効かないか */
export function measureCell(m: MeasureDef, steps: PathStep[]): CellMark | undefined {
  const roles = new Set(m.patches.map((p) => p.role));
  const mine = steps.filter((s) => roles.has(s.role));
  for (const s of mine) {
    const hit = s.ineffective.find((i) => i.mitigation === m.mitigation);
    if (hit) return { kind: "ineffective", reasonJa: hit.reasonJa };
  }
  if (mine.some((s) => s.mitigations.includes(m.mitigation))) return { kind: "effective" };
  return undefined;
}

/**
 * 表の列：経路の本線の段階（前提と枝は除く）に、枝・前提の段階でも効き目のある対策があればその列を足す。
 * 列は出てくる順。同じ段階（型紙の段階 ID）は複数の経路があっても 1 列
 */
export function measureColumns(v: Verdict, graph: Graph, measures: MeasureDef[]): MeasureCol[] {
  const label = (id: string) => graph.nodes.find((n) => n.id === id)?.label ?? id;
  const byKey = new Map<string, PathStep[]>();
  const order: string[] = [];
  for (const s of stepsOf(v)) {
    const k = keyOf(s);
    if (!byKey.has(k)) {
      byKey.set(k, []);
      order.push(k);
    }
    byKey.get(k)?.push(s);
  }
  const cols: MeasureCol[] = [];
  for (const k of order) {
    const steps = byKey.get(k) ?? [];
    const main = steps.some((s) => !s.precondition && !s.branch);
    if (!main && !measures.some((m) => measureCell(m, steps))) continue;
    const first = steps[0];
    if (!first) continue;
    const sameNode = steps.every((s) => s.nodeId === first.nodeId);
    const stageJa = steps.find((s) => s.labelJa)?.labelJa;
    cols.push({
      key: k,
      label: sameNode ? label(first.nodeId) : (stageJa ?? label(first.nodeId)),
      ...(stageJa ? { stageJa } : {}),
    });
  }
  return cols;
}

/** 対策 1 行ぶんのセル（列と同じ並び） */
export function measureRow(
  m: MeasureDef,
  v: Verdict,
  cols: MeasureCol[],
): (CellMark | undefined)[] {
  const steps = stepsOf(v);
  return cols.map((c) =>
    measureCell(
      m,
      steps.filter((s) => keyOf(s) === c.key),
    ),
  );
}

/**
 * 費用の目安の金額（円）。/api/evaluate の costJa（engine の formatJpy の書式）の先頭の金額を読む。
 * 単価だけの文（「13,200 円 ／ 台・年（台数未登録…）」）や「見積もり待ち」「社内ルール」は金額なし
 */
export function costJpyOf(costJa: string): number | undefined {
  const m = /^(?:約\s*)?([\d,]+(?:\.\d+)?)\s*(億円|万円|円)(?!\s*／\s*[台人社サ])/.exec(costJa);
  if (!m?.[1] || !m[2]) return undefined;
  const n = Number(m[1].replaceAll(",", ""));
  if (!Number.isFinite(n)) return undefined;
  return Math.round(n * (m[2] === "億円" ? 100_000_000 : m[2] === "万円" ? 10_000 : 1));
}

/** 費用の欄の見せ方：金額が分かるものは棒（長さで比べる）、それ以外は札 */
export type CostCell =
  | { kind: "bar"; ratio: number; textJa: string }
  | { kind: "internal"; textJa: string }
  | { kind: "quote"; textJa: string }
  | { kind: "unit"; textJa: string };

/** 括弧書きの内訳を除いた、金額の語（「約 158.4 万円／年」） */
const head = (costJa: string): string => costJa.split("（")[0]?.trim() ?? costJa;

export function costCells(costJas: Record<string, string>): Record<string, CostCell> {
  const amounts = Object.entries(costJas).flatMap(([id, ja]) => {
    const n = costJpyOf(ja);
    return n !== undefined ? [[id, n] as const] : [];
  });
  const max = Math.max(1, ...amounts.map(([, n]) => n));
  const out: Record<string, CostCell> = {};
  for (const [id, ja] of Object.entries(costJas)) {
    const n = costJpyOf(ja);
    if (n !== undefined)
      out[id] = { kind: "bar", ratio: Math.max(0.06, n / max), textJa: head(ja) };
    else if (ja.startsWith("社内ルール")) out[id] = { kind: "internal", textJa: "外部費用なし" };
    else if (ja.includes("見積もり待ち")) out[id] = { kind: "quote", textJa: "見積もり待ち" };
    else out[id] = { kind: "unit", textJa: head(ja) };
  }
  return out;
}
