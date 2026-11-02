/**
 * KEV との突き合わせで見つかった矛盾（ベンダー回答・担当者登録と公開情報の食い違い）を、
 * 反映したカルテの id と一緒にこのブラウザの localStorage に残し、担当者画面の矛盾の欄に出す。
 * 反映後のカルテでは属性が公開情報で上書きされているので、判定（engine）からは矛盾が見えなくなるため
 */
import { z } from "zod";
import type { Contradiction } from "./types.ts";

const KEY = "uchidai.kev.v1";

const Saved = z.object({
  profileId: z.string().min(1),
  /** 資産 ID → 直近の突き合わせで出た矛盾（無ければ空） */
  byAsset: z.record(
    z.string(),
    z.object({
      checkedAt: z.string(),
      catalogVersion: z.string(),
      items: z.array(
        z.object({
          assetId: z.string(),
          messageJa: z.string(),
          external: z.string(),
          registered: z.string(),
        }),
      ),
    }),
  ),
});
export type KevHints = z.infer<typeof Saved>;

const safe = <T>(fn: () => T, fallback: T): T => {
  try {
    return fn();
  } catch {
    return fallback;
  }
};

export function parseKevHints(raw: string | null): KevHints | undefined {
  if (!raw) return undefined;
  const parsed = safe<unknown>(() => JSON.parse(raw), undefined);
  const ok = Saved.safeParse(parsed);
  return ok.success ? ok.data : undefined;
}

export const kevHints = {
  load: (): KevHints | undefined => safe(() => parseKevHints(localStorage.getItem(KEY)), undefined),
  /** 資産 1 つの突き合わせの結果（矛盾）を記録する。別のカルテの記録は捨てる */
  record: (
    profileId: string,
    assetId: string,
    catalogVersion: string,
    checkedAt: string,
    items: Contradiction[],
  ) => {
    const current = kevHints.load();
    const base: KevHints =
      current && current.profileId === profileId ? current : { profileId, byAsset: {} };
    base.byAsset[assetId] = { checkedAt, catalogVersion, items };
    safe(() => localStorage.setItem(KEY, JSON.stringify(base)), undefined);
  },
  /** このカルテの矛盾をすべて（資産をまたいで）返す */
  contradictionsFor: (profileId: string): (Contradiction & { checkedAt: string })[] => {
    const h = kevHints.load();
    if (!h || h.profileId !== profileId) return [];
    return Object.values(h.byAsset).flatMap((x) =>
      x.items.map((c) => ({ ...c, checkedAt: x.checkedAt })),
    );
  },
  clear: () => safe(() => localStorage.removeItem(KEY), undefined),
};
