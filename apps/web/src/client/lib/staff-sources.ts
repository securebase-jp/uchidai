/**
 * 担当者画面の出典番号。同じ出典は画面のどこでも同じ番号にする（結論カードの報告義務、時間軸の期限、対策の費用）。
 * id は knowledge/sources.yaml の sources[].id
 */
export const STAFF_SOURCES = {
  "ppc-guidelines": { n: 1, titleJa: "個人情報保護委員会「ガイドライン（通則編）」" },
  "npa-soudan": { n: 2, titleJa: "警察庁「サイバー事案に関する相談窓口」" },
  "mpd-bec": { n: 3, titleJa: "警視庁「ビジネスメール詐欺（BEC）対策」" },
  "ipa-sme-jirei-cost": { n: 4, titleJa: "IPA 事例集 別紙「想定被害額計算明細」" },
} as const;

export type StaffSourceId = keyof typeof STAFF_SOURCES;
