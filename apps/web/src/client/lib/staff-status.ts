/**
 * 担当者画面の固定帯の件数と、折りたたみの「自動で開く」条件。
 * 新しい判定は作らず、未確認の件数（rankPending の結果）と送信箱の依頼（answer の有無）を数えるだけにする
 */
import type { RequestView } from "../../shared/requests.ts";

export type StaffCounts = {
  /** 未確認の項目（rankPending の件数） */
  pending: number;
  /** 依頼済み・回答待ち（answer がない依頼） */
  waiting: number;
  /** 回答あり（answer がある依頼） */
  answered: number;
};

export function staffCounts(
  pendingCount: number,
  items: readonly Pick<RequestView, "answer">[],
): StaffCounts {
  const answered = items.filter((r) => r.answer !== undefined).length;
  return { pending: pendingCount, waiting: items.length - answered, answered };
}

/** 確認依頼を自動で開くか：未確認がある、または送信箱に回答待ち・回答ありがある */
export function requestsAutoOpen(c: StaffCounts): boolean {
  return c.pending > 0 || c.waiting > 0 || c.answered > 0;
}
