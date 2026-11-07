/** 送信箱の表示で使う小さな整形（1 項目 1 依頼とまとめ依頼で共通） */
import type { RequestView } from "../../shared/requests.ts";

export const VIA_LABEL: Record<RequestView["sentVia"], string> = {
  outbox: "送信箱（未送信）",
  mailto: "メールソフトで送る",
  smtp: "SMTP で送信済み",
};

export const STATUS_WORD = {
  present: "「ある」",
  absent: "「ない」",
  unknown: "「不明」",
} as const;

export function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString("ja-JP", {
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}

/** <input type="datetime-local"> の値（手元の時刻）にする */
export function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
