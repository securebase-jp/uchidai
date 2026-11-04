import { describe, expect, it } from "vitest";
import { packPages, parseUnicodeRange, pdfFileName, rangeCoversAny } from "./pdf-layout.ts";

describe("pdfFileName", () => {
  it("社長向けの一枚_会社名_日付.pdf にする", () => {
    expect(pdfFileName("デモ精工株式会社", new Date(2026, 10, 4))).toBe(
      "社長向けの一枚_デモ精工株式会社_20261104.pdf",
    );
  });
  it("ファイル名に使えない文字と空白は除く", () => {
    expect(pdfFileName('A/B: "C" <D> E|F?*', new Date(2026, 0, 9))).toBe(
      "社長向けの一枚_ABCDEF_20260109.pdf",
    );
  });
  it("会社名が空なら「会社」", () => {
    expect(pdfFileName(" / ", new Date(2026, 0, 1))).toBe("社長向けの一枚_会社_20260101.pdf");
  });
});

describe("packPages", () => {
  const item = (height: number, breakBefore = false) => ({ height, breakBefore });
  it("収まる間は同じページに置き、break-before の節から次のページにする", () => {
    expect(packPages([item(100), item(300), item(200, true), item(100)], 1000)).toEqual([
      [0, 1],
      [2, 3],
    ]);
  });
  it("収まらない節は、途中で切らずに次のページの先頭へ送る", () => {
    expect(packPages([item(400), item(400), item(300), item(100)], 1000)).toEqual([
      [0, 1],
      [2, 3],
    ]);
  });
  it("ページより高い節は、その節だけで 1 ページにする（空のページを作らない）", () => {
    expect(packPages([item(1500), item(100)], 1000)).toEqual([[0], [1]]);
    expect(packPages([item(100, true), item(100)], 1000)).toEqual([[0, 1]]);
  });
});

describe("unicode-range", () => {
  it("範囲、単独、ワイルドカードを読む", () => {
    expect(parseUnicodeRange("U+3000-3003, U+3005, U+4E??")).toEqual([
      [0x3000, 0x3003],
      [0x3005, 0x3005],
      [0x4e00, 0x4eff],
    ]);
  });
  it("使う文字が入る分割だけを選ぶ（範囲が空なら全部）", () => {
    const ranges = parseUnicodeRange("U+3000-3003, U+4E00-4EFF");
    expect(rangeCoversAny(ranges, [0x41, 0x4e2d])).toBe(true);
    expect(rangeCoversAny(ranges, [0x41, 0x5000])).toBe(false);
    expect(rangeCoversAny([], [0x41])).toBe(true);
  });
});
