/**
 * 製品名の選択肢（knowledge/kev/products.yaml の製品）と、保存済みの自由記述の製品名を選択肢に当てる関数。
 * 当てはめ方はサーバの matchProduct（packages/engine/src/kev.ts）と同じ：正規化した別名が入力に含まれれば一致し、
 * 複数なら一致した別名が最も長い製品。保存の形は変えない（選んだ製品は labelJa を製品名の文字として保存する）
 */
export type KevProductOption = {
  id: string;
  labelJa: string;
  aliases: string[];
  /** 版の書き方の例（products.yaml の versionHintJa） */
  versionHintJa?: string;
};

/** 製品の選択肢のうち「一覧にない製品」を表す値 */
export const OTHER_PRODUCT = "other";

/** 表記ゆれを吸収する正規化（サーバの normalizeProductText と同じ） */
export function normalizeProductText(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\-_・/／()（）]/g, "");
}

/** 自由入力の製品名を一覧の製品に当てる。当たらなければ undefined（→「その他」） */
export function matchProductId(
  input: string | undefined,
  products: KevProductOption[],
): string | undefined {
  const text = normalizeProductText(input ?? "");
  if (!text) return undefined;
  let best: { id: string; length: number } | undefined;
  for (const p of products) {
    for (const alias of p.aliases) {
      const a = normalizeProductText(alias);
      if (!a || !text.includes(a)) continue;
      if (!best || a.length > best.length) best = { id: p.id, length: a.length };
    }
  }
  return best?.id;
}

/** 版の欄の placeholder と、補足（情報ボタンに入れる）。「例：7.0.14（FortiOS の版…）」を分ける */
export function versionHint(hintJa: string | undefined): { placeholder: string; noteJa?: string } {
  const m = hintJa?.match(/^(例：[^（(]+?)\s*(?:[（(](.*)[）)])?$/);
  if (!m?.[1]) return { placeholder: "例：7.0.14" };
  return { placeholder: m[1], ...(m[2] ? { noteJa: m[2] } : {}) };
}
