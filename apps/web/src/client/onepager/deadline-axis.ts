/**
 * 社長向けの一枚の「期限の図」の配置（Day 0 から最大日数までの横の時間軸）。
 * 日数は engine が決めた期限をそのまま置く。ここでは目盛りと、ラベルが重ならない行の割り当てだけを決める
 */

export const AX = {
  W: 560,
  X0: 24,
  X1: 514,
  ROW_H: 19,
  ICON: 13,
  CHAR_W: 11,
  TOP: 2,
  BELOW: 25,
} as const;

/** 同じ日・同じ種類の期限は 1 つの点にまとめる（速報と本人通知など。行を増やさない） */
export function groupByDayKind<T extends { day: number; kind: string }>(items: T[]): T[][] {
  const groups: T[][] = [];
  for (const it of items) {
    const g = groups.find((x) => x[0]?.day === it.day && x[0]?.kind === it.kind);
    if (g) g.push(it);
    else groups.push([it]);
  }
  return groups;
}

export type AxisInput = { day: number; label: string; hasSource: boolean };
export type AxisItem = {
  index: number;
  day: number;
  px: number;
  /** 右端を越えるとき、ラベルを点の左に出す */
  flip: boolean;
  row: number;
  /** ラベルの箱（行の割り当てに使った範囲） */
  left: number;
  right: number;
};
export type AxisLayout = {
  maxDay: number;
  ticks: { day: number; x: number }[];
  items: AxisItem[];
  rows: number;
  axisY: number;
  height: number;
  x: (day: number) => number;
};

/** 目盛りの間隔：最大日数に応じて 1・5・10 日 */
export function tickStep(maxDay: number): number {
  return maxDay <= 14 ? 1 : maxDay <= 30 ? 5 : 10;
}

export function layoutDeadlineAxis(inputs: AxisInput[]): AxisLayout {
  const maxDay = Math.max(5, ...inputs.map((i) => i.day));
  const x = (day: number) => AX.X0 + ((AX.X1 - AX.X0) * Math.min(day, maxDay)) / maxDay;
  const step = tickStep(maxDay);
  const ticks: { day: number; x: number }[] = [];
  for (let d = 0; d <= maxDay; d += step) ticks.push({ day: d, x: x(d) });
  if (ticks.at(-1)?.day !== maxDay) ticks.push({ day: maxDay, x: x(maxDay) });

  const order = inputs
    .map((_, index) => index)
    .sort((a, b) => (inputs[a]?.day ?? 0) - (inputs[b]?.day ?? 0) || a - b);
  const rowEnd: number[] = [];
  const items: AxisItem[] = order.map((index) => {
    const it = inputs[index] as AxisInput;
    const px = x(it.day);
    const textW = it.label.length * AX.CHAR_W + (it.hasSource ? 10 : 0);
    const flip = px + 10 + textW > AX.X1 + 12;
    const left = flip ? px - 10 - textW : px - AX.ICON / 2;
    const right = flip ? px + AX.ICON / 2 : px + 10 + textW;
    let row = 0;
    while ((rowEnd[row] ?? Number.NEGATIVE_INFINITY) > left - 8) row++;
    rowEnd[row] = right;
    return { index, day: it.day, px, flip, row, left, right };
  });
  const rows = Math.max(1, ...items.map((i) => i.row + 1));
  const axisY = AX.TOP + rows * AX.ROW_H + 10;
  return { maxDay, ticks, items, rows, axisY, height: axisY + AX.BELOW, x };
}
