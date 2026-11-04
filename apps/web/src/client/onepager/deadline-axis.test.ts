import { describe, expect, it } from "vitest";
import { AX, layoutDeadlineAxis, tickStep } from "./deadline-axis.ts";

const input = (day: number, label: string, hasSource = false) => ({ day, label, hasSource });

describe("layoutDeadlineAxis（社長向けの一枚の期限の図）", () => {
  it("目盛りは 0 から最大日数まで。最大日数は 5 日以上", () => {
    expect(layoutDeadlineAxis([input(1, "警察へ相談")]).maxDay).toBe(5);
    const l = layoutDeadlineAxis([input(0, "a"), input(60, "確報")]);
    expect(l.maxDay).toBe(60);
    expect(l.ticks.map((t) => t.day)).toEqual([0, 10, 20, 30, 40, 50, 60]);
    expect(l.ticks[0]?.x).toBe(AX.X0);
    expect(l.ticks.at(-1)?.x).toBe(AX.X1);
    expect(tickStep(14)).toBe(1);
    expect(tickStep(30)).toBe(5);
  });
  it("近い日の出来事は別の行に積み、同じ行の箱は重ならない", () => {
    const l = layoutDeadlineAxis([
      input(0, "侵入・暗号化"),
      input(1, "警察へ相談", true),
      input(2, "取引先へ通知"),
      input(5, "委員会へ速報", true),
      input(30, "保険会社へ通知"),
      input(60, "委員会へ確報", true),
    ]);
    expect(l.rows).toBeGreaterThan(1);
    for (const a of l.items)
      for (const b of l.items)
        if (a.index < b.index && a.row === b.row)
          expect(a.right <= b.left - 8 || b.right <= a.left - 8).toBe(true);
    expect(l.items.map((i) => i.day)).toEqual([0, 1, 2, 5, 30, 60]);
  });
  it("右端を越えるラベルは点の左に出す", () => {
    const l = layoutDeadlineAxis([input(0, "a"), input(60, "委員会へ確報", true)]);
    expect(l.items[1]?.flip).toBe(true);
    expect(l.items[1]?.right).toBeLessThanOrEqual(AX.X1 + AX.ICON);
    expect(l.items[0]?.flip).toBe(false);
  });
});
