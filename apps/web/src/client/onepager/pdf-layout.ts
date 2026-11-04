/**
 * 一枚の PDF 書き出しの、DOM に依らない部分（テストできるように分けてある）。
 * - ファイル名
 * - 節をページに詰める規則（印刷用レイアウトの改ページ位置に合わせる）
 * - 画像化する文書に埋め込むフォントの選び方（使う文字を含む分割だけを埋める）
 */

/** 社長向けの一枚_<会社名>_<YYYYMMDD>.pdf。ファイル名に使えない文字と空白は除く */
export function pdfFileName(companyName: string, date: Date): string {
  const company = [...companyName]
    .filter((ch) => (ch.codePointAt(0) ?? 0) >= 0x20 && !/[\\/:*?"<>|\s]/.test(ch))
    .join("")
    .slice(0, 60);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `社長向けの一枚_${company || "会社"}_${y}${m}${d}.pdf`;
}

export type PackItem = {
  /** 節の高さ（px。上下の余白を含む） */
  height: number;
  /** この節から必ず次のページ（印刷の break-before: page） */
  breakBefore: boolean;
};

/**
 * 節を順にページへ詰める。節の途中では切らない：収まらない節は次のページの先頭に送る。
 * 戻り値は、ページごとの節の番号。ページが空のまま次へ送ることはしない（1 つの節がページより高くても、その節だけで 1 ページ）
 */
export function packPages(items: PackItem[], available: number): number[][] {
  const pages: number[][] = [[]];
  let used = 0;
  items.forEach((item, i) => {
    const page = pages[pages.length - 1] as number[];
    if (page.length > 0 && (item.breakBefore || used + item.height > available)) {
      pages.push([i]);
      used = item.height;
    } else {
      page.push(i);
      used += item.height;
    }
  });
  return pages;
}

/** "U+3000-3003, U+4E??" の形の unicode-range を [開始, 終了] の並びにする。空は「すべて」 */
export function parseUnicodeRange(value: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const part of value.split(",")) {
    const m = /^\s*U\+([0-9a-fA-F?]+)(?:-([0-9a-fA-F]+))?\s*$/.exec(part);
    if (!m?.[1]) continue;
    const a = m[1];
    if (a.includes("?")) {
      out.push([
        Number.parseInt(a.replace(/\?/g, "0"), 16),
        Number.parseInt(a.replace(/\?/g, "f"), 16),
      ]);
    } else {
      const lo = Number.parseInt(a, 16);
      out.push([lo, m[2] ? Number.parseInt(m[2], 16) : lo]);
    }
  }
  return out;
}

/** unicode-range のどれかに、使う文字が 1 つでも入っているか（範囲が空なら入っている扱い） */
export function rangeCoversAny(
  ranges: Array<[number, number]>,
  codePoints: Iterable<number>,
): boolean {
  if (ranges.length === 0) return true;
  for (const cp of codePoints) {
    for (const [lo, hi] of ranges) if (cp >= lo && cp <= hi) return true;
  }
  return false;
}
