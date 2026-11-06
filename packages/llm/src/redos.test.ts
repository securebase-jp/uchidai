/**
 * 正規表現の書き直し（CodeQL の polynomial-redos 対応）の確認。
 * - LEGACY_* は書き直す前の正規表現。書き直したあとも同じ判定になることを、ランダムな入力で突き合わせる
 * - 数万字の繰り返しのような病的な入力でも、50ms 以内に終わる
 */
import { describe, expect, it } from "vitest";
import { cleanTitle } from "./article.ts";
import { BANNED_PATTERNS, checkLine } from "./attacker-safety.ts";
import { ESTIMATE_RE } from "./onepager-writer.ts";
import { REPLY_EXAMPLE_RE } from "./writer.ts";

function rng(seed: number): () => number {
  let x = seed;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 2 ** 32;
  };
}
function randomStrings(seed: number, alphabet: string[], count: number, maxLen: number): string[] {
  const rand = rng(seed);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const len = 1 + Math.floor(rand() * maxLen);
    let s = "";
    for (let j = 0; j < len; j++) s += alphabet[Math.floor(rand() * alphabet.length)];
    out.push(s);
  }
  return out;
}
function fast(label: string, f: () => unknown): void {
  const t0 = performance.now();
  f();
  expect(performance.now() - t0, label).toBeLessThan(50);
}

const LEGACY_ESTIMATE = /\d\s*日|\d[\d,.]*\s*(万|億)?円|止まり|止まる|止まっ|停止/;
const LEGACY_EXAMPLE = /例[:：]\s*[「『(（]?\s*\d/;
const LEGACY_PORT = /(ポート|port)\s*(番号)?\s*[:：]?\s*\d{2,5}\b/i;
const LEGACY_EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const LEGACY_TITLE_1 =
  /\s*[（(]\s*\d+\s*ページ目[^）)]*[）)]?\s*(?:[：:｜|]\s*[^：:｜|]{1,30})?\s*$/;
const LEGACY_TITLE_2 = /\s*[（(]\s*全\s*\d+\s*ページ\s*[）)]\s*$/;
const legacyCleanTitle = (t: string) =>
  t.replace(LEGACY_TITLE_1, "").replace(LEGACY_TITLE_2, "").trim();

const emailRe = BANNED_PATTERNS.find((re) => re.source.includes("@"));
const portRe = BANNED_PATTERNS.find((re) => re.source.includes("ポート"));

describe("ESTIMATE_RE（試算の文の判定）", () => {
  it("決まった言い方を通す", () => {
    for (const s of ["3日止まる", "約300万円", "1,200円", "2.5億円", "業務が停止します", "5万円"])
      expect(ESTIMATE_RE.test(s), s).toBe(true);
    for (const s of ["円安", "万円", "1,2,.", "金額は不明", "日"])
      expect(ESTIMATE_RE.test(s), s).toBe(false);
  });
  it("書き直す前と同じ判定になる", () => {
    for (const s of randomStrings(
      1,
      ["0", "7", ",", ".", " ", "万", "億", "円", "日", "止", "x"],
      20000,
      12,
    ))
      expect(ESTIMATE_RE.test(s), JSON.stringify(s)).toBe(LEGACY_ESTIMATE.test(s));
  });
  it("病的な入力でも遅くならない", () => {
    const n = 50_000;
    for (const s of [
      "0".repeat(n),
      `0${",".repeat(n)}`,
      "0,".repeat(n / 2),
      `0${" ".repeat(n)}`,
      "0.".repeat(n / 2),
    ])
      fast(s.slice(0, 8), () => ESTIMATE_RE.test(s));
  });
});

describe("返信の例に番号を入れる表現（REPLY_EXAMPLE_RE）", () => {
  it("決まった言い方を通す", () => {
    for (const s of ["例：1", "例: 「 2」", "例:（ 3", "例：\n『4"])
      expect(REPLY_EXAMPLE_RE.test(s), s).toBe(true);
    for (const s of ["例：あ", "例の1", "例： 「あ1"])
      expect(REPLY_EXAMPLE_RE.test(s), s).toBe(false);
  });
  it("書き直す前と同じ判定になる", () => {
    for (const s of randomStrings(
      2,
      ["例", ":", "：", " ", "「", "『", "(", "（", "1", "x", "\n"],
      20000,
      12,
    ))
      expect(REPLY_EXAMPLE_RE.test(s), JSON.stringify(s)).toBe(LEGACY_EXAMPLE.test(s));
  });
  it("病的な入力でも遅くならない", () => {
    const n = 50_000;
    for (const s of [`例:${" ".repeat(n)}`, `例:「${" ".repeat(n)}`, "例: ".repeat(n / 3)])
      fast(s.slice(0, 6), () => REPLY_EXAMPLE_RE.test(s));
  });
});

describe("攻撃者側の安全検査（ポート番号・メールアドレス）", () => {
  it("両方の正規表現が見つかる", () => {
    expect(portRe).toBeDefined();
    expect(emailRe).toBeDefined();
  });
  it("ポート番号：書き直す前と同じ判定・同じ一致になる", () => {
    for (const s of randomStrings(
      3,
      ["ポート", "port", "Port", "番号", ":", "：", " ", "\n", "3", "1", "x"],
      20000,
      10,
    )) {
      expect(portRe?.exec(s)?.[0], JSON.stringify(s)).toBe(LEGACY_PORT.exec(s)?.[0]);
    }
  });
  it("メールアドレス：書き直す前と同じ判定・同じ一致になる", () => {
    for (const s of randomStrings(
      4,
      ["a", "B", "1", ".", "+", "-", "_", "@", " ", "x"],
      20000,
      12,
    )) {
      expect(emailRe?.exec(s)?.[0], JSON.stringify(s)).toBe(LEGACY_EMAIL.exec(s)?.[0]);
    }
  });
  it("checkLine の判定は変わらない", () => {
    expect(checkLine("ポート 3389 を開ける").ok).toBe(false);
    expect(checkLine("ポート番号：445").ok).toBe(false);
    expect(checkLine("a.b+c@example.co.jp").ok).toBe(false);
    expect(checkLine("入口を一つにまとめる").ok).toBe(true);
  });
  it("病的な入力でも遅くならない", () => {
    const n = 50_000;
    for (const s of ["+".repeat(n), "a.".repeat(n / 2), `${"a".repeat(n)}@`, "a@".repeat(n / 2)])
      fast(s.slice(0, 8), () => emailRe?.exec(s));
    for (const s of ["+".repeat(n), `ポート${" ".repeat(n)}`, `ポート番号${" ".repeat(n)}x`])
      fast(s.slice(0, 8), () => checkLine(s));
  });
});

describe("cleanTitle（題の末尾のページ番号と媒体名）", () => {
  it("書き直す前と同じ結果になる（短い題）", () => {
    const alphabet = [
      "（",
      "(",
      "）",
      ")",
      " ",
      "1",
      "ページ目",
      "全",
      "ページ",
      "：",
      ":",
      "｜",
      "|",
      "A",
      "\n",
    ];
    for (const s of randomStrings(5, alphabet, 20000, 10))
      expect(cleanTitle(s), JSON.stringify(s)).toBe(legacyCleanTitle(s));
  });
  it("記事の題は変わらない", () => {
    expect(cleanTitle("複数サーバがランサム被害（1ページ目 / 全1ページ）：Security NEXT")).toBe(
      "複数サーバがランサム被害",
    );
    expect(cleanTitle("見出し（2ページ目")).toBe("見出し");
    expect(cleanTitle("見出し （全3ページ）")).toBe("見出し");
    expect(cleanTitle("会員向けの1ページ目の使い方を解説")).toBe(
      "会員向けの1ページ目の使い方を解説",
    );
  });
  it("長い題でも、末尾のページ番号は消え、先頭は保たれる", () => {
    const head = "あ".repeat(5000);
    expect(cleanTitle(`${head}（1ページ目）：Security NEXT`)).toBe(head);
    expect(cleanTitle(`${head}  （全2ページ）`)).toBe(head);
  });
  it("病的な入力でも遅くならない", () => {
    const n = 50_000;
    for (const s of [
      " ".repeat(n),
      `（0ページ目${" ".repeat(n)}x`,
      `（0ページ目${" ".repeat(n)}）x`,
      "（0ページ目".repeat(n / 6),
      `${"（0ページ目 ".repeat(n / 8)}）x`,
      `（全0${" ".repeat(n)}`,
      `x${" ：".repeat(n / 2)}`,
    ])
      fast(s.slice(0, 8), () => cleanTitle(s));
  });
});
