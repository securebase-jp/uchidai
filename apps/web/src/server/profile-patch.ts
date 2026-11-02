/**
 * 対策ボタンと回答を会社カルテに適用する（/api/evaluate、/api/onepager、/api/attacker/* で同じ手順）。
 * 知らない対策 ID と、カルテに無い資産への回答は黙って落とす（画面の古い状態で落ちないように）
 */
import {
  applyAnswer,
  applyMeasures,
  type CompanyProfile,
  type Knowledge,
  type MeasureDef,
} from "@uchidai/engine";
import type { AnswerInput } from "../shared/api.ts";

export function resolveMeasures(measureIds: string[], k: Knowledge): MeasureDef[] {
  return measureIds
    .map((id) => k.measures.find((m) => m.id === id))
    .filter((m): m is MeasureDef => m !== undefined);
}

export function patchProfile(
  profile: CompanyProfile,
  measureIds: string[],
  answers: AnswerInput[],
  k: Knowledge,
): { profile: CompanyProfile; measures: MeasureDef[] } {
  const measures = resolveMeasures(measureIds, k);
  let next = applyMeasures(profile, measures);
  for (const a of answers) {
    if (!next.assets.some((x) => x.id === a.assetId)) continue;
    const { answeredAt, noteJa, attrs, ...rest } = a;
    next = applyAnswer(next, {
      ...rest,
      ...(answeredAt !== undefined ? { answeredAt } : {}),
      ...(noteJa !== undefined ? { noteJa } : {}),
      ...(attrs !== undefined ? { attrs } : {}),
    });
  }
  return { profile: next, measures };
}
