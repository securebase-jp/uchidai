/**
 * 個人情報の入力で、カルテ（CompanyProfile）の形では残せない「選んだ区分」だけをこのブラウザに覚えておく。
 * - 件数の区分（〜100／〜1,000／1,000 超／1 万超／10 万超）：カルテに残るのは 1,000 件を超えるか（over1000）だけなので、
 *   どの区分を押したかをここに覚える（正確な件数が入ったら件数から決める）
 * - 要配慮個人情報の「分からない」：カルテの sensitive は真偽値なので「分からない」を持てない。
 *   分からないうちは sensitive を既定値（含まない）のままにし、選ぶまで未回答として扱うことをここに覚える
 * カルテの保存、判定、JSON の書き出しには入らない。保存できなくても画面は動く
 */
import type { CountBucket } from "./choices.ts";

export type PersonalHint = {
  bucket?: CountBucket["id"];
  /** 要配慮かどうかが「分からない」（選び直すまで、判定は sensitive の既定値＝含まない のまま） */
  sensitiveUnknown?: true;
};
/** カルテの id → 資産の id → ヒント */
export type HintStore = Record<string, Record<string, PersonalHint>>;

const KEY = "uchidai.personalHints.v1";
const BUCKET_IDS = new Set<string>(["le100", "le1000", "gt1000", "gt10k", "gt100k"]);

export function parseHints(raw: string | null): HintStore {
  if (!raw) return {};
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v !== "object" || v === null || Array.isArray(v)) return {};
    const out: HintStore = {};
    for (const [profileId, assets] of Object.entries(v)) {
      if (typeof assets !== "object" || assets === null) continue;
      for (const [assetId, h] of Object.entries(assets)) {
        if (typeof h !== "object" || h === null) continue;
        const hint: PersonalHint = {};
        const { bucket, sensitiveUnknown } = h as Record<string, unknown>;
        if (typeof bucket === "string" && BUCKET_IDS.has(bucket))
          hint.bucket = bucket as CountBucket["id"];
        if (sensitiveUnknown === true) hint.sensitiveUnknown = true;
        if (Object.keys(hint).length === 0) continue;
        out[profileId] = { ...(out[profileId] ?? {}), [assetId]: hint };
      }
    }
    return out;
  } catch {
    return {};
  }
}

export const getHint = (store: HintStore, profileId: string, assetId: string): PersonalHint =>
  store[profileId]?.[assetId] ?? {};

/** ヒントを書き換えた新しい store。patch の値が undefined の項目は消し、空になったら資産ごと消す。patch が undefined なら資産ごと消す */
export function withHint(
  store: HintStore,
  profileId: string,
  assetId: string,
  patch: { [K in keyof PersonalHint]?: PersonalHint[K] | undefined } | undefined,
): HintStore {
  const next: HintStore = { ...store, [profileId]: { ...(store[profileId] ?? {}) } };
  const assets = next[profileId] as Record<string, PersonalHint>;
  if (patch === undefined) {
    delete assets[assetId];
  } else {
    const merged: PersonalHint = { ...(assets[assetId] ?? {}) };
    for (const k of ["bucket", "sensitiveUnknown"] as const) {
      if (!(k in patch)) continue;
      if (patch[k] === undefined) delete merged[k];
      else Object.assign(merged, { [k]: patch[k] });
    }
    if (Object.keys(merged).length === 0) delete assets[assetId];
    else assets[assetId] = merged;
  }
  if (Object.keys(assets).length === 0) delete next[profileId];
  return next;
}

export const personalHints = {
  load(): HintStore {
    try {
      return parseHints(localStorage.getItem(KEY));
    } catch {
      return {};
    }
  },
  save(store: HintStore): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(store));
    } catch {
      // 保存できなくても画面は動く（区分の表示が、カルテから決められる形に戻るだけ）
    }
  },
};
