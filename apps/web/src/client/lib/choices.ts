/**
 * カルテの入力を「よくある値のボタン ＋ 数値の欄」にするための値と、金額・日数の表示。
 * ボタンは入力の近道にすぎない。保存されるのは数値そのもので、カルテの形（CompanyProfile）は変えない
 */

/** 年商から 1 日あたりの売上を出すときの営業日数（i ボタンの中にも書く） */
export const WORKING_DAYS_PER_YEAR = 250;

export type Preset = { value: number; label?: string };

const grouped = (n: number): string => n.toLocaleString("ja-JP", { maximumFractionDigits: 2 });

/** 円の読みやすい表記：10,000,000 → 1,000万円、250,000,000 → 2.5億円。端数があれば円のまま */
export function formatJpy(n: number, withUnit = true): string {
  const unit = withUnit ? "円" : "";
  if (!Number.isFinite(n)) return "";
  if (n !== 0 && n % 1e8 === 0) return `${grouped(n / 1e8)}億${unit}`;
  if (n >= 1e8 && n % 1e7 === 0) return `${grouped(n / 1e8)}億${unit}`;
  if (n !== 0 && n % 1e4 === 0) return `${grouped(n / 1e4)}万${unit}`;
  return `${grouped(n)}${unit}`;
}

const plain = (values: number[]): Preset[] => values.map((value) => ({ value }));

export const EMPLOYEE_PRESETS: Preset[] = plain([10, 30, 50, 100, 300, 1000]);
export const TRANSFER_PRESETS: Preset[] = [1e6, 3e6, 5e6, 1e7, 3e7].map((value) => ({
  value,
  label: formatJpy(value, false),
}));
export const INSURANCE_DAYS_PRESETS: Preset[] = plain([3, 7, 14, 30, 60]);
export const DAY_PRESETS: Preset[] = plain([0, 1, 2, 3, 5, 7, 10, 14, 30]);

/** 年商のボタン（円）。押すと 1 日あたりの売上（年 250 営業日で割り、万円に丸めた値）が入る */
export const ANNUAL_REVENUE_JPY = [3e7, 5e7, 1e8, 3e8, 5e8, 1e9, 2.5e9, 5e9, 1e10];

/** 年商 → 1 日あたりの売上（円）。250 営業日で割り、四捨五入で万円単位にする（25 億円 → 1,000 万円） */
export function dailyFromAnnual(annualJpy: number): number {
  return Math.round(annualJpy / WORKING_DAYS_PER_YEAR / 10_000) * 10_000;
}

export const REVENUE_PRESETS: Preset[] = ANNUAL_REVENUE_JPY.map((annual) => ({
  value: dailyFromAnnual(annual),
  label: formatJpy(annual, false),
}));

export type NumberInputResult = { kind: "commit"; value: number | undefined } | { kind: "revert" };

/**
 * 数値の欄で確定された文字を数値にする。空は allowEmpty なら「消す」（undefined）、そうでなければ元に戻す。
 * 数でないものは元に戻す。小数は四捨五入、min より小さい値は min にそろえる
 */
export function numberFromText(
  text: string,
  opts: { min?: number; allowEmpty?: boolean } = {},
): NumberInputResult {
  const t = text.trim();
  if (t === "")
    return opts.allowEmpty === false ? { kind: "revert" } : { kind: "commit", value: undefined };
  const n = Number(t);
  if (!Number.isFinite(n)) return { kind: "revert" };
  const rounded = Math.round(n);
  const value = opts.min !== undefined ? Math.max(opts.min, rounded) : rounded;
  return { kind: "commit", value };
}

// ---------------------------------------------------------------------------
// 個人情報の件数のざっくりした区分
// ---------------------------------------------------------------------------
export type CountBucket = {
  id: "le100" | "le1000" | "gt1000" | "gt10k" | "gt100k";
  labelJa: string;
  /** 1,000 件を超えるか（カルテの over1000。報告義務の判定に使う） */
  over1000: boolean;
};

export const COUNT_BUCKETS: CountBucket[] = [
  { id: "le100", labelJa: "〜100", over1000: false },
  { id: "le1000", labelJa: "〜1,000", over1000: false },
  { id: "gt1000", labelJa: "1,000 超", over1000: true },
  { id: "gt10k", labelJa: "1 万超", over1000: true },
  { id: "gt100k", labelJa: "10 万超", over1000: true },
];

/** 正確な件数が入っているときの区分 */
export function bucketOfCount(count: number): CountBucket["id"] {
  if (count <= 100) return "le100";
  if (count <= 1000) return "le1000";
  if (count <= 10_000) return "gt1000";
  if (count <= 100_000) return "gt10k";
  return "gt100k";
}

/**
 * 画面で押された状態に見せる区分。正確な件数があれば件数から、無ければ覚えた区分（カルテの over1000 と食い違えば捨てる）。
 * 覚えが無くて 1,000 件を超えるなら「1,000 超」（それ以上かもしれないが、分かっているのはここまで）。
 * 覚えが無くて 1,000 件を超えないときは、まだ選んでいないので何も押された状態にしない
 */
export function shownBucket(
  count: number | undefined,
  over1000: boolean,
  remembered: CountBucket["id"] | undefined,
): CountBucket["id"] | undefined {
  if (count !== undefined) return bucketOfCount(count);
  if (remembered && COUNT_BUCKETS.find((b) => b.id === remembered)?.over1000 === over1000)
    return remembered;
  return over1000 ? "gt1000" : undefined;
}

// ---------------------------------------------------------------------------
// 候補（<datalist>）に出す例
// ---------------------------------------------------------------------------
/** 個人情報の内容の例（短い文）。業種を問わず、会社が持ちがちなもの */
export const PERSONAL_DATA_EXAMPLES = [
  "取引先担当者の連絡先",
  "従業員の氏名・住所・給与",
  "顧客の氏名・住所・電話番号",
  "患者の氏名・病歴・診療記録",
  "採用応募者の履歴書",
  "会員・ポイントカードの登録情報",
  "マイナンバー（従業員・扶養家族）",
];

/** 影響先（業務が止まったときに困る相手）の例。業種の構成パターンの例が無いときの固定の数例 */
export const AFFECTS_EXAMPLES = [
  "取引先の納期",
  "顧客への請求",
  "患者の診療",
  "現場の工程",
  "従業員の給与支払い",
];
