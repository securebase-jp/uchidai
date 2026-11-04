/**
 * 時間軸の出来事の見せ方（短いラベルと出典）。日数・期限の値は engine が決めたものをそのまま使い、ここでは語を短くするだけ。
 * 期限の出典は knowledge/deadlines.yaml の sourceId。保険と取引先の期限は会社カルテが根拠なので番号は付けない
 */
import type { StaffSourceId } from "./staff-sources.ts";
import type { TimelineEvent } from "./types.ts";

/** 時間軸（TimelineEvent）と社長向けの一枚の期限（OnePagerDeadline）の両方に使えるよう、必要な項目だけを見る */
export type EventLike = Pick<TimelineEvent, "day" | "labelJa" | "deadlineId"> & { kind: string };

const SHORT_BY_DEADLINE: Record<string, string> = {
  "ppc-prompt": "委員会へ速報",
  "ppc-final": "委員会へ確報",
  "ppc-notify": "本人へ通知",
  insurance: "保険会社へ通知",
  "partner-notice": "取引先へ通知",
  police: "警察へ相談",
  "bank-recall": "銀行へ組戻し依頼",
};

/** 期限の ID → 出典の id（knowledge/deadlines.yaml の sourceId のうち、画面に番号を出すもの） */
const SOURCE_BY_DEADLINE: Record<string, StaffSourceId> = {
  "ppc-prompt": "ppc-guidelines",
  "ppc-final": "ppc-guidelines",
  "ppc-notify": "ppc-guidelines",
  police: "npa-soudan",
  "bank-recall": "mpd-bec",
};

export function eventSourceId(e: Pick<EventLike, "deadlineId">): StaffSourceId | undefined {
  return e.deadlineId ? SOURCE_BY_DEADLINE[e.deadlineId] : undefined;
}

/** 軸の上に出す短いラベル。詳しい文は押したときに出す */
export function shortLabel(e: EventLike): string {
  if (e.deadlineId && SHORT_BY_DEADLINE[e.deadlineId])
    return SHORT_BY_DEADLINE[e.deadlineId] ?? e.labelJa;
  const quoted = /「(.+?)」/.exec(e.labelJa)?.[1];
  switch (e.kind) {
    case "business_stop":
      return quoted ? `${quoted}が止まる` : "侵入・暗号化";
    case "recovery":
      return quoted ? `${quoted}が復旧` : e.labelJa;
    case "partner":
      return "取引先に影響";
    case "money":
      return "送金してしまう";
    case "legal":
      return e.day === 0 ? "流出が発覚" : e.labelJa;
    default:
      return e.labelJa;
  }
}
