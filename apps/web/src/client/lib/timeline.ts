/**
 * 時間軸の出来事。本来は engine（S4）が Verdict.timeline に入れる。
 * 空のあいだは、判定結果の数値から仮の出来事を組み立てる（画面に「仮」と明記する）。
 */
import type { CompanyProfile, TimelineEvent, Verdict } from "./types.ts";

export type TimelineView = { events: TimelineEvent[]; provisional: boolean; lastDay: number };

export function timelineOf(verdict: Verdict, profile: CompanyProfile): TimelineView {
  if (verdict.timeline.length > 0) {
    const events = [...verdict.timeline].sort((a, b) => a.day - b.day);
    return { events, provisional: false, lastDay: Math.max(7, ...events.map((e) => e.day)) };
  }
  const events: TimelineEvent[] = [];
  const impact = verdict.impact;
  const reached = verdict.result === "breached" || verdict.result === "mitigated";
  if (!reached) return { events, provisional: true, lastDay: 7 };

  for (const s of impact.stopped) {
    events.push({
      day: 0,
      kind: "business_stop",
      labelJa: `${s.name} が止まる`,
      detailJa: `手作業で回せるのは ${s.manualDays} 日まで`,
      businessId: s.businessId,
    });
    const biz = profile.businesses.find((b) => b.id === s.businessId);
    if (biz?.affectsJa && s.days > s.manualDays) {
      events.push({
        day: s.manualDays + 1,
        kind: "partner",
        labelJa: `${biz.affectsJa}に影響`,
        detailJa: `${s.name} の手作業の限界（${s.manualDays} 日）を超える`,
        businessId: s.businessId,
      });
    }
  }
  events.push({
    day: 1,
    kind: "police",
    labelJa: "警察への相談",
    detailJa: "都道府県警察のサイバー犯罪相談窓口",
  });
  if (impact.reportRequired) {
    events.push({
      day: 3,
      kind: "legal",
      labelJa: "個人情報保護委員会へ速報",
      detailJa: "漏えいのおそれを知ってから概ね 3〜5 日以内",
      sourceJa: "個人情報保護法 施行規則（仮。S4 が出典つきで確定）",
    });
    events.push({
      day: 60,
      kind: "legal",
      labelJa: "個人情報保護委員会へ確報",
      detailJa: "不正アクセスによる漏えいは 60 日以内",
      sourceJa: "個人情報保護法 施行規則（仮。S4 が出典つきで確定）",
    });
  }
  if (profile.cyberInsurance?.enrolled && profile.cyberInsurance.notifyWithinDays) {
    events.push({
      day: profile.cyberInsurance.notifyWithinDays,
      kind: "insurance",
      labelJa: "サイバー保険への通知期限",
      detailJa: `契約上 ${profile.cyberInsurance.notifyWithinDays} 日以内`,
    });
  }
  if (impact.downtimeDays > 0) {
    events.push({
      day: impact.downtimeDays,
      kind: "recovery",
      labelJa: "復旧の目安",
      detailJa: `停止 ${impact.downtimeDays} 日`,
    });
  }
  if (impact.revenueImpactJpy) {
    events.push({
      day: impact.downtimeDays,
      kind: "money",
      labelJa: "売上影響の目安",
      detailJa: `停止 ${impact.downtimeDays} 日 × 1 日の売上`,
    });
  }
  if (impact.moneyLossJpy) {
    events.push({ day: 0, kind: "money", labelJa: "資金の流出", detailJa: "送金された金額" });
  }
  events.sort((a, b) => a.day - b.day);
  const lastDay = Math.max(
    7,
    ...events.filter((e) => e.kind !== "legal" || e.day <= 30).map((e) => e.day),
  );
  return { events, provisional: true, lastDay };
}
