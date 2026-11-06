/**
 * 文の中の円の金額を数値にする（記事の被害額を、読解が写した値と照合するため。Claude に金額の計算をさせない）。
 * 「2億5600万円」「約2.56億円」「5,880万円」「4500万円」「300円」を扱う。全角・半角は NFKC でそろえる
 */
export function parseYenAmounts(text: string): number[] {
  const t = text.normalize("NFKC").replace(/,/g, "");
  const out: number[] = [];
  const re =
    /(?<!\d)(\d+(?:\.\d+)?)\s*億\s*(?:(\d+(?:\.\d+)?)\s*万\s*)?円|(?<!\d)(\d+(?:\.\d+)?)\s*万\s*円|(?<!\d)(\d+(?:\.\d+)?)\s*円/g;
  for (const m of t.matchAll(re)) {
    if (m[1] !== undefined) out.push(Math.round(Number(m[1]) * 1e8 + Number(m[2] ?? 0) * 1e4));
    else if (m[3] !== undefined) out.push(Math.round(Number(m[3]) * 1e4));
    else if (m[4] !== undefined) out.push(Math.round(Number(m[4])));
  }
  return out;
}

/** 金額（円）が、文の中の円の金額のどれかと一致するか（誤差 1% まで。「約」「およそ」の丸めを許す） */
export function yenAppearsIn(amount: number, text: string): boolean {
  return parseYenAmounts(text).some((a) => a > 0 && Math.abs(a - amount) / a <= 0.01);
}
