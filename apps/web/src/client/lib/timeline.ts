/**
 * 時間軸の出来事。engine（S4）が Verdict.timeline に入れる。止まった経路や入口なしでは空
 */
import type { CompanyProfile, TimelineEvent, Verdict } from "./types.ts";

export type TimelineView = { events: TimelineEvent[]; provisional: boolean; lastDay: number };

export function timelineOf(verdict: Verdict, _profile: CompanyProfile): TimelineView {
  const events = [...verdict.timeline].sort((a, b) => a.day - b.day);
  const near = events.filter((e) => e.kind !== "legal" || e.day <= 30).map((e) => e.day);
  return { events, provisional: false, lastDay: Math.max(7, ...near) };
}
