import { describe, expect, it } from "vitest";
import {
  ANNUAL_REVENUE_JPY,
  bucketOfCount,
  COUNT_BUCKETS,
  dailyFromAnnual,
  formatJpy,
  numberFromText,
  REVENUE_PRESETS,
  shownBucket,
  TRANSFER_PRESETS,
} from "./choices.ts";

describe("dailyFromAnnual（年商 → 1 日あたりの売上。年 250 営業日、万円に丸める）", () => {
  it("25 億円 → 1,000 万円", () => expect(dailyFromAnnual(2.5e9)).toBe(10_000_000));
  it("3,000 万円 → 12 万円、1 億円 → 40 万円、100 億円 → 4,000 万円", () => {
    expect(dailyFromAnnual(3e7)).toBe(120_000);
    expect(dailyFromAnnual(1e8)).toBe(400_000);
    expect(dailyFromAnnual(1e10)).toBe(40_000_000);
  });
  it("万円未満は四捨五入（1 億 3,000 万円 → 52 万円）", () => {
    expect(dailyFromAnnual(1.3e8)).toBe(520_000);
    expect(dailyFromAnnual(1.35e8)).toBe(540_000);
  });
  it("年商のボタンは 9 つで、1 日分の値はどれも重ならない", () => {
    expect(ANNUAL_REVENUE_JPY).toHaveLength(9);
    expect(new Set(REVENUE_PRESETS.map((p) => p.value)).size).toBe(9);
    expect(REVENUE_PRESETS.map((p) => p.label)).toEqual([
      "3,000万",
      "5,000万",
      "1億",
      "3億",
      "5億",
      "10億",
      "25億",
      "50億",
      "100億",
    ]);
  });
});

describe("formatJpy", () => {
  it("万・億で読みやすく", () => {
    expect(formatJpy(10_000_000)).toBe("1,000万円");
    expect(formatJpy(100_000_000)).toBe("1億円");
    expect(formatJpy(250_000_000)).toBe("2.5億円");
    expect(formatJpy(1_000_000, false)).toBe("100万");
    expect(formatJpy(12_345)).toBe("12,345円");
    expect(formatJpy(0)).toBe("0円");
  });
  it("送金額のボタンの表記", () => {
    expect(TRANSFER_PRESETS.map((p) => p.label)).toEqual([
      "100万",
      "300万",
      "500万",
      "1,000万",
      "3,000万",
    ]);
  });
});

describe("numberFromText（欄を離れたときの確定）", () => {
  it("数字はそのまま、小数は四捨五入", () => {
    expect(numberFromText("30")).toEqual({ kind: "commit", value: 30 });
    expect(numberFromText("2.6")).toEqual({ kind: "commit", value: 3 });
  });
  it("空は消す（allowEmpty が false なら元に戻す）", () => {
    expect(numberFromText("  ")).toEqual({ kind: "commit", value: undefined });
    expect(numberFromText("", { allowEmpty: false })).toEqual({ kind: "revert" });
  });
  it("数でないものは元に戻し、min より小さければ min にそろえる", () => {
    expect(numberFromText("abc")).toEqual({ kind: "revert" });
    expect(numberFromText("-5", { min: 0 })).toEqual({ kind: "commit", value: 0 });
    expect(numberFromText("0", { min: 1 })).toEqual({ kind: "commit", value: 1 });
  });
});

describe("件数の区分", () => {
  it("正確な件数から区分を決める（境界は含む側が小さい区分）", () => {
    expect(bucketOfCount(100)).toBe("le100");
    expect(bucketOfCount(101)).toBe("le1000");
    expect(bucketOfCount(1000)).toBe("le1000");
    expect(bucketOfCount(1001)).toBe("gt1000");
    expect(bucketOfCount(10_001)).toBe("gt10k");
    expect(bucketOfCount(100_001)).toBe("gt100k");
  });
  it("1,000 件を超える区分だけ over1000", () => {
    expect(COUNT_BUCKETS.map((b) => b.over1000)).toEqual([false, false, true, true, true]);
  });
});

describe("shownBucket（押された状態に見せる件数の区分）", () => {
  it("正確な件数があれば件数から決める（覚えた区分より優先）", () => {
    expect(shownBucket(5200, true, "gt100k")).toBe("gt1000");
    expect(shownBucket(80, false, undefined)).toBe("le100");
  });
  it("件数が無ければ覚えた区分。カルテの over1000 と食い違うなら捨てる", () => {
    expect(shownBucket(undefined, true, "gt10k")).toBe("gt10k");
    expect(shownBucket(undefined, false, "le100")).toBe("le100");
    expect(shownBucket(undefined, true, "le100")).toBe("gt1000");
    expect(shownBucket(undefined, false, "gt10k")).toBeUndefined();
  });
  it("覚えが無ければ、1,000 件超だけ「1,000 超」。超えない（未選択かもしれない）ときは何も押さない", () => {
    expect(shownBucket(undefined, true, undefined)).toBe("gt1000");
    expect(shownBucket(undefined, false, undefined)).toBeUndefined();
  });
});
