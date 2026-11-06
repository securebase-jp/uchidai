/**
 * parseYenAmounts：金額の読み取りの固定と、正規表現が病的な入力で遅くならないことの確認。
 * LEGACY は書き直す前の正規表現。書き直したあとも同じ結果を返すことを、ランダムな入力で突き合わせる。
 */
import { describe, expect, it } from "vitest";
import { parseYenAmounts } from "./yen.ts";

const LEGACY =
  /(\d+(?:\.\d+)?)\s*億\s*(?:(\d+(?:\.\d+)?)\s*万)?\s*円|(\d+(?:\.\d+)?)\s*万\s*円|(\d+(?:\.\d+)?)\s*円/g;
function legacyParse(text: string): number[] {
  const t = text.normalize("NFKC").replace(/,/g, "");
  const out: number[] = [];
  for (const m of t.matchAll(LEGACY)) {
    if (m[1] !== undefined) out.push(Math.round(Number(m[1]) * 1e8 + Number(m[2] ?? 0) * 1e4));
    else if (m[3] !== undefined) out.push(Math.round(Number(m[3]) * 1e4));
    else if (m[4] !== undefined) out.push(Math.round(Number(m[4])));
  }
  return out;
}

/** 再現できる乱数（xorshift） */
function rng(seed: number): () => number {
  let x = seed;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 2 ** 32;
  };
}

describe("parseYenAmounts", () => {
  it("円・万円・億円・億万円を読む", () => {
    expect(parseYenAmounts("被害額は1,500円")).toEqual([1500]);
    expect(parseYenAmounts("約300万円、あるいは 2.5万 円")).toEqual([3_000_000, 25_000]);
    expect(parseYenAmounts("1億2000万円と3億円")).toEqual([120_000_000, 300_000_000]);
    expect(parseYenAmounts("１２３円（全角）")).toEqual([123]);
    expect(parseYenAmounts("金額は不明です")).toEqual([]);
    expect(parseYenAmounts("1.5.3円")).toEqual([5]); // 1.5 は「円」に続かないので、その次の 5.3 円から読む
  });

  it("書き直す前の正規表現と、ランダムな入力で同じ結果になる", () => {
    const rand = rng(20261106);
    const alphabet = ["0", "1", "9", ".", ",", " ", "\n", "億", "万", "円", "x", "。"];
    for (let i = 0; i < 20000; i++) {
      const len = 1 + Math.floor(rand() * 14);
      let s = "";
      for (let j = 0; j < len; j++) s += alphabet[Math.floor(rand() * alphabet.length)];
      expect(parseYenAmounts(s), JSON.stringify(s)).toEqual(legacyParse(s));
    }
  });

  it("数字や空白が数万字続いても 50ms 以内に終わる", () => {
    const n = 50_000;
    const cases = [
      "0".repeat(n),
      `${"0".repeat(n)}x`,
      `0億${" ".repeat(n)}`,
      `0億${" ".repeat(n)}0万${" ".repeat(n)}`,
      `0億 `.repeat(n / 3),
      `0.`.repeat(n / 2),
      `0 `.repeat(n / 2),
      " 億".repeat(n / 2),
    ];
    for (const s of cases) {
      const t0 = performance.now();
      parseYenAmounts(s);
      expect(performance.now() - t0, s.slice(0, 12)).toBeLessThan(50);
    }
  });
});
