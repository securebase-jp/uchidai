/** 状態・由来・根拠の表示語と色（色だけに頼らず、必ず語も出す） */
import type { EvidenceKind, PathSource, StepState, VerdictResult } from "./types.ts";

export type Tone = "red" | "amber" | "green" | "cyan" | "ink";

export const STATE_LABEL: Record<StepState, string> = {
  blocked: "止まる",
  recoverable: "復旧できる",
  unknown: "未確認",
  human: "人次第",
  breached: "突破される",
};
export const STATE_TONE: Record<StepState, Tone> = {
  blocked: "green",
  recoverable: "green",
  unknown: "amber",
  human: "amber",
  breached: "red",
};
export const SOURCE_LABEL: Record<PathSource, string> = {
  stated: "記事に記載",
  inferred: "推定",
  candidate: "入口候補",
  ai: "AIが見つけた経路",
};
export const EVIDENCE_LABEL: Record<EvidenceKind, string> = {
  external: "外部確認",
  vendor: "ベンダー回答",
  registered: "担当者登録",
  none: "根拠なし",
};
export const RESULT_TONE: Record<VerdictResult, Tone> = {
  blocked: "green",
  mitigated: "amber",
  breached: "red",
  pending: "amber",
  no_entry: "cyan",
  out_of_scope: "ink",
};
export const RESULT_SHORT: Record<VerdictResult, string> = {
  blocked: "止められます",
  mitigated: "抑えられます",
  breached: "大丈夫ではありません",
  pending: "確認中",
  no_entry: "入口なし",
  out_of_scope: "対象外",
};

/** 社長向けの言い換え（ID と専門用語を出さない） */
export const PLAIN_STATE: Record<StepState, string> = {
  blocked: "ここで止まります",
  recoverable: "やられますが、戻せます",
  unknown: "分かりません（確認が必要）",
  human: "人の判断にかかっています",
  breached: "入られます",
};

export function yen(v: number | undefined): string {
  if (v === undefined || v <= 0) return "0円";
  if (v >= 100_000_000) {
    const oku = v / 100_000_000;
    return `約${oku >= 10 ? Math.round(oku) : Math.round(oku * 10) / 10}億円`;
  }
  if (v >= 10_000) return `約${Math.round(v / 10_000).toLocaleString("ja-JP")}万円`;
  return `${v.toLocaleString("ja-JP")}円`;
}

/** 長い資産名を図の中で短くする（全文は title と一覧に出す） */
export function shortLabel(label: string, max = 10): string {
  const cut = label.split(/[（(]/)[0] ?? label;
  return cut.length > max ? `${cut.slice(0, max - 1)}…` : cut;
}
