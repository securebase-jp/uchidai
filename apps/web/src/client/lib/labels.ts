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
  stated: "記事に書いてある",
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

/** この語の直後で折り返す（自然な切れ目） */
const BREAK_AFTER = ["・", " ", "　", "への", "との", "の", "用"];
/** この語の直前で折り返す（図によく出る名詞のまとまり） */
const BREAK_BEFORE = [
  "システム",
  "サーバ",
  "ストレージ",
  "アカウント",
  "メール",
  "サイト",
  "ホームページ",
  "デスクトップ",
  "バックアップ",
  "リモート",
  "データ",
  "装置",
  "区画",
  "担当",
  "接続",
  "同期",
  "共有",
  "報告",
  "影響",
  "委員会",
];

/** 自然に折り返せる位置（その位置の直前までが 1 行目） */
function breakPoints(text: string): number[] {
  const points = new Set<number>();
  for (const t of BREAK_AFTER) {
    for (let k = text.indexOf(t); k >= 0; k = text.indexOf(t, k + 1)) points.add(k + t.length);
  }
  for (const t of BREAK_BEFORE) {
    for (let k = text.indexOf(t); k >= 0; k = text.indexOf(t, k + 1)) points.add(k);
  }
  return [...points].filter((i) => i > 0 && i < text.length).sort((a, b) => a - b);
}

function splitAt(text: string, i: number): [string, string] {
  return [text.slice(0, i).trimEnd(), text.slice(i).trimStart()];
}

/**
 * 資産名を図の箱に入る 2 行までに折り返す（全文は title と一覧に出す）。
 * 括弧以降（「（廃止済み）」など）は落とす。1 行に perLine 文字まで。
 * 折り返しは中黒・空白・「の」「用」の直後や、「システム」「サーバ」などの語の直前を優先し、
 * 両方の行が収まる候補の中で行の長さが近いものを選ぶ。無ければ文字数で切る。
 * 2 行に収まらない（perLine の 2 倍を超える）ときだけ末尾を「…」にする。
 */
export function wrapLabel(label: string, perLine = 7): string[] {
  const cut = (label.split(/[（(]/)[0] ?? label).trim();
  if (cut.length <= perLine) return [cut];
  const candidates = breakPoints(cut).filter((i) => i <= perLine);
  const fitting = candidates
    .map((i) => splitAt(cut, i))
    .filter(([a, b]) => a.length > 0 && b.length > 0 && b.length <= perLine)
    .sort((x, y) => Math.abs(x[0].length - x[1].length) - Math.abs(y[0].length - y[1].length));
  if (fitting[0]) return fitting[0];
  if (cut.length <= perLine * 2) return splitAt(cut, Math.ceil(cut.length / 2));
  const i = candidates.length ? (candidates.at(-1) ?? perLine) : perLine;
  const [first, rest] = splitAt(cut, i);
  return [first, `${rest.slice(0, perLine - 1)}…`];
}
