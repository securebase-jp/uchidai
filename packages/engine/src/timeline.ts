/**
 * 時間軸：経営への影響と期限データから、発覚日を Day 0 とする出来事の列を作る
 *
 * 各出来事は businessId / assetId / deadlineId で元の業務・資産・期限に紐づく。対策で経路が止まれば
 * 再判定で影響が消え、紐づく出来事も消える。結論が blocked / no_entry / out_of_scope のときは空。
 */

import { damageTypeOf, formatJpy, pathsOf } from "./impact.ts";
import { type DeadlinesFile, type Knowledge, loadDeadlines, loadKnowledge } from "./knowledge.ts";
import type { CompanyProfile, DamageType, Impact, TimelineEvent, Verdict } from "./types.ts";

export type TimelineOptions = {
  knowledge?: Knowledge;
  deadlines?: DeadlinesFile;
  damageType?: DamageType;
  /** 記事が書く漏えいした情報の種類（leak-kinds.yaml の id）。leak_kind の期限に使う */
  leakedKinds?: string[];
};

const PROFILE_SOURCE = "会社カルテ（手作業で回せる日数、復旧にかかる日数）";

function sourceName(deadlines: DeadlinesFile, id: string): string | undefined {
  return deadlines.sources.find((s) => s.id === id)?.nameJa;
}

export function buildTimeline(
  impact: Impact,
  profile: CompanyProfile,
  verdict: Pick<Verdict, "result" | "paths">,
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

  // Day 0：何が起きるか（出来事は damage-types.yaml の day0）
  // 型紙に紐づかない経路（AI 攻撃者の経路）は種類が決まらないので、先頭の種類の出来事を使う
  const types = options.knowledge?.damageTypes ?? loadKnowledge().damageTypes;
  const day0 = (types.find((d) => d.id === damageType) ?? types[0])?.day0;
  if (day0) {
    push({
      day: 0,
      kind: day0.kind,
      labelJa: day0.labelJa,
      ...(day0.showMoneyLoss && impact.moneyLossJpy !== undefined
        ? {
            detailJa: `送金額の目安 ${formatJpy(impact.moneyLossJpy)}（会社カルテの想定額）`,
            sourceJa: "会社カルテ（送金額の目安）",
          }
        : {}),
      ...(day0.sourceJa ? { sourceJa: day0.sourceJa } : {}),
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
        // 法令に日数の定めがある期限だけ「◯ 日以内」を添える。目安で置く期限（本人通知）はラベルのまま
        const range =
          d.daysFrom !== undefined && d.daysFrom !== d.days
            ? `${d.daysFrom}〜${d.days} 日以内`
            : d.daysIfUnauthorized !== undefined
              ? `${day} 日以内`
              : undefined;
        const who = impact.personalDataReached
          .map(
            (p) =>
              `${p.descriptionJa}${p.count !== undefined ? ` ${p.count.toLocaleString("ja-JP")} 件` : ""}`,
          )
          .join("、");
        push({
          ...base,
          day,
          labelJa: range ? `${d.labelJa}（${range}）` : d.labelJa,
          detailJa: `${who}。${(impact.reportReasonsJa ?? []).join("。")}${d.daysIfUnauthorized !== undefined ? `。不正アクセス由来のため ${d.daysIfUnauthorized} 日以内` : ""}`,
          ...(firstPersonal ? { assetId: firstPersonal.assetId } : {}),
        });
        break;
      }
      case "insurance": {
        const ins = profile.cyberInsurance;
        if (!ins?.enrolled) break;
        const day = d.daysFromProfile ? ins.notifyWithinDays : d.days;
        if (day === undefined) {
          // 加入しているが通知期限がカルテに無い：期限は示せないので、発覚当日に「要確認」として置く
          push({
            ...base,
            day: 0,
            labelJa: `${d.labelJa}（期限はカルテ未登録。保険証券で確認）`,
            detailJa: `${d.basisJa}。日数が登録されていないため、発覚当日に置いた（要確認）`,
          });
          break;
        }
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
      case "leak_kind": {
        if (d.days === undefined || !d.leakKinds?.some((l) => options.leakedKinds?.includes(l)))
          break;
        push({
          ...base,
          day: d.days,
          labelJa: d.labelJa,
          detailJa: `${d.basisJa}${d.status === "unverified" ? "（要確認）" : ""}`,
        });
        break;
      }
      case "damage_type": {
        if (!damageType || !d.damageTypes?.includes(damageType) || d.days === undefined) break;
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

  return mergeSameEvents(events)
    .map((e, i) => ({ e, i }))
    .sort((a, b) => a.e.day - b.e.day || a.i - b.i)
    .map(({ e }) => e);
}

/**
 * 同じ日・同じ種類・同じ見出しの出来事は 1 つにまとめる（複数の業務が同じ取引先に影響するとき、
 * 「3 日目から取引先の納期に影響」が並ばないように）。詳細は重複を除いてつなぐ。
 * 紐づく業務は先頭のものを残す（対策で経路が止まれば、まとめた出来事ごと消える）
 */
function mergeSameEvents(events: TimelineEvent[]): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  const index = new Map<string, number>();
  for (const e of events) {
    const key = `${e.kind}|${e.day}|${e.labelJa}`;
    const at = index.get(key);
    if (at === undefined) {
      index.set(key, out.length);
      out.push(e);
      continue;
    }
    const prev = out[at];
    if (prev && e.detailJa && !(prev.detailJa ?? "").includes(e.detailJa)) {
      out[at] = {
        ...prev,
        detailJa: prev.detailJa ? `${prev.detailJa}／${e.detailJa}` : e.detailJa,
      };
    }
  }
  return out;
}
