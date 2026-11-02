/**
 * 時間軸：経営への影響と期限データから、発覚日を Day 0 とする出来事の列を作る
 *
 * 各出来事は businessId / assetId / deadlineId で元の業務・資産・期限に紐づく。対策で経路が止まれば
 * 再判定で影響が消え、紐づく出来事も消える。結論が blocked / no_entry / out_of_scope のときは空。
 */

import { damageTypeOf, formatJpy, pathsOf } from "./impact.ts";
import { type DeadlinesFile, type Knowledge, loadDeadlines } from "./knowledge.ts";
import type {
  AttackPath,
  CompanyProfile,
  DamageType,
  Impact,
  TimelineEvent,
  Verdict,
} from "./types.ts";

export type TimelineOptions = {
  knowledge?: Knowledge;
  deadlines?: DeadlinesFile;
  damageType?: DamageType;
};

const PROFILE_SOURCE = "会社カルテ（手作業で回せる日数、復旧にかかる日数）";

function sourceName(deadlines: DeadlinesFile, id: string): string | undefined {
  return deadlines.sources.find((s) => s.id === id)?.nameJa;
}

export function buildTimeline(
  impact: Impact,
  profile: CompanyProfile,
  verdict: Pick<Verdict, "result"> & (Pick<Verdict, "paths"> | { paths: AttackPath[] }),
  options: TimelineOptions = {},
): TimelineEvent[] {
  if (
    verdict.result === "blocked" ||
    verdict.result === "no_entry" ||
    verdict.result === "out_of_scope"
  )
    return [];
  const paths = pathsOf(verdict);
  if (!paths.some((p) => p.reachedCore)) return [];

  const deadlines = options.deadlines ?? options.knowledge?.deadlines ?? loadDeadlines();
  const damageType = options.damageType ?? damageTypeOf(paths, options.knowledge);
  const events: TimelineEvent[] = [];
  const push = (e: TimelineEvent) => events.push(e);

  // Day 0：何が起きるか
  if (damageType === "bec") {
    push({
      day: 0,
      kind: "money",
      labelJa: "なりすましの指示で送金してしまう",
      ...(impact.moneyLossJpy !== undefined
        ? {
            detailJa: `送金額の目安 ${formatJpy(impact.moneyLossJpy)}（会社カルテの想定額）`,
            sourceJa: "会社カルテ（送金額の目安）",
          }
        : {}),
    });
  } else if (damageType === "data_breach") {
    push({ day: 0, kind: "legal", labelJa: "個人情報の流出が発覚する" });
  } else {
    push({
      day: 0,
      kind: "business_stop",
      labelJa: "侵入され、社内のシステムが暗号化される",
      sourceJa: "判定した攻撃経路",
    });
  }

  // 止まる業務、取引先への影響、復旧
  for (const s of impact.stopped) {
    push({
      day: 0,
      kind: "business_stop",
      labelJa: `「${s.name}」が止まる`,
      detailJa:
        s.manualDays > 0
          ? `手作業で回せるのは ${s.manualDays} 日まで。復旧まで ${s.days} 日`
          : `手作業では回せない。復旧まで ${s.days} 日`,
      sourceJa: PROFILE_SOURCE,
      businessId: s.businessId,
    });
    if (s.partnerDay !== undefined) {
      push({
        day: s.partnerDay,
        kind: "partner",
        labelJa: `${s.partnerDay} 日目から${s.affectsJa ?? "取引先"}に影響`,
        detailJa: `「${s.name}」を手作業で回せる ${s.manualDays} 日を超える`,
        sourceJa: PROFILE_SOURCE,
        businessId: s.businessId,
      });
    }
    push({
      day: s.days,
      kind: "recovery",
      labelJa: `「${s.name}」が復旧する`,
      detailJa: `停止 ${s.days} 日`,
      sourceJa: PROFILE_SOURCE,
      businessId: s.businessId,
    });
  }

  // 期限（固定データ）
  const firstPersonal = impact.personalDataReached[0];
  const partnerBusiness = impact.stopped.find((s) => s.partnerDay === impact.partnerImpactDay);
  for (const d of deadlines.deadlines) {
    const source = sourceName(deadlines, d.sourceId);
    const base = {
      kind: d.kind,
      deadlineId: d.id,
      ...(source ? { sourceJa: source } : {}),
    };
    switch (d.appliesTo) {
      case "report": {
        if (!impact.reportRequired || d.days === undefined) break;
        const day = d.daysIfUnauthorized ?? d.days;
        const range =
          d.daysFrom !== undefined && d.daysFrom !== d.days
            ? `${d.daysFrom}〜${d.days} 日以内`
            : `${day} 日以内`;
        const who = impact.personalDataReached
          .map(
            (p) =>
              `${p.descriptionJa}${p.count !== undefined ? ` ${p.count.toLocaleString("ja-JP")} 件` : ""}`,
          )
          .join("、");
        push({
          ...base,
          day,
          labelJa: `${d.labelJa}（${range}）`,
          detailJa: `${who}。${(impact.reportReasonsJa ?? []).join("。")}${d.daysIfUnauthorized !== undefined ? `。不正アクセス由来のため ${d.daysIfUnauthorized} 日以内` : ""}`,
          ...(firstPersonal ? { assetId: firstPersonal.assetId } : {}),
        });
        break;
      }
      case "insurance": {
        const ins = profile.cyberInsurance;
        if (!ins?.enrolled) break;
        const day = d.daysFromProfile ? ins.notifyWithinDays : d.days;
        if (day === undefined) break;
        push({
          ...base,
          day,
          labelJa: `${d.labelJa}（${day} 日以内）`,
          detailJa: d.basisJa,
        });
        break;
      }
      case "partner": {
        if (impact.partnerImpactDay === undefined) break;
        const day = d.placement === "before_partner_impact" ? impact.partnerImpactDay - 1 : d.days;
        if (day === undefined) break;
        push({
          ...base,
          day,
          labelJa: d.labelJa,
          detailJa: `${d.basisJa}${d.status === "unverified" ? "（要確認）" : ""}`,
          ...(partnerBusiness ? { businessId: partnerBusiness.businessId } : {}),
        });
        break;
      }
      case "bec": {
        if (damageType !== "bec" || d.days === undefined) break;
        push({ ...base, day: d.days, labelJa: d.labelJa, detailJa: d.basisJa });
        break;
      }
      case "police":
      case "all": {
        if (d.days === undefined) break;
        push({ ...base, day: d.days, labelJa: `${d.labelJa}（目安）`, detailJa: d.basisJa });
        break;
      }
    }
  }

  return events
    .map((e, i) => ({ e, i }))
    .sort((a, b) => a.e.day - b.e.day || a.i - b.i)
    .map(({ e }) => e);
}
