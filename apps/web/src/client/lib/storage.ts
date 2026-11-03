/**
 * 会社カルテの保存先はブラウザの localStorage だけ。
 * 読むときは形を検証し、壊れたデータや古い形式は捨てる（画面が落ちないように）。
 * engine の zod スキーマはブラウザに持ち込まない（engine は fs を読む）ので、画面が触る項目だけをここで見る。
 */
import { z } from "zod";
import type { Case, CompanyProfile } from "./types.ts";

const KEY = "uchidai.profile.v1";
const CASE_KEY = "uchidai.case.v1";
/** 上部バーで選んだ架空の会社の ID（自社のカルテとは別に覚える。自社の保存は消さない） */
const EXAMPLE_KEY = "uchidai.example.v1";
const THEME_KEY = "uchidai.theme";
const MOTION_KEY = "uchidai.reduceMotion";

const safe = <T>(fn: () => T, fallback: T): T => {
  try {
    return fn();
  } catch {
    return fallback;
  }
};

/** 画面とサーバ（CompanyProfile.parse）が触る項目の最低限の形 */
const SavedProfile = z.looseObject({
  id: z.string().min(1),
  companyName: z.string(),
  pattern: z.enum(["manufacturing", "office", "healthcare"]),
  assets: z.array(
    z.looseObject({
      id: z.string(),
      role: z.string(),
      label: z.string(),
      controls: z.array(z.looseObject({ mitigation: z.string(), status: z.string() })),
      attrs: z.record(z.string(), z.unknown()),
      attrEvidence: z.record(z.string(), z.string()),
    }),
  ),
  businesses: z.array(z.looseObject({ id: z.string(), name: z.string() })),
});

/** 保存された JSON を CompanyProfile として読めるか確かめる。読めなければ undefined */
export function parseSavedProfile(raw: string | null): CompanyProfile | undefined {
  if (!raw) return undefined;
  const parsed = safe<unknown>(() => JSON.parse(raw), undefined);
  const ok = SavedProfile.safeParse(parsed);
  return ok.success ? (ok.data as unknown as CompanyProfile) : undefined;
}

/** 担当者が選んだ事例（記事の読解結果か記録済みの事例）と、その出所。再読み込みで既定の事例に戻らないように保存する */
const SavedCase = z.object({
  case: z.looseObject({
    title: z.string(),
    damageType: z.string(),
    clarity: z.string(),
    steps: z.array(z.unknown()),
  }),
  meta: z.object({
    label: z.string(),
    sourceJa: z.string(),
    sourceUrl: z.string().optional(),
    recorded: z.looseObject({ caseId: z.string() }).optional(),
  }),
});
export type SavedCase = {
  case: Case;
  meta: { label: string; sourceJa: string; sourceUrl?: string; recorded?: { caseId: string } };
};

export function parseSavedCase(raw: string | null): SavedCase | undefined {
  if (!raw) return undefined;
  const parsed = safe<unknown>(() => JSON.parse(raw), undefined);
  const ok = SavedCase.safeParse(parsed);
  return ok.success ? (ok.data as unknown as SavedCase) : undefined;
}

const Theme = z.enum(["dark", "light"]);
/** サーバの SafeId と同じ形（examples/<id>.json） */
const ExampleId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);

export const storage = {
  loadProfile: (): CompanyProfile | undefined =>
    safe(() => {
      const p = parseSavedProfile(localStorage.getItem(KEY));
      // 壊れた保存は消して、次回も同じ失敗を繰り返さない
      if (!p && localStorage.getItem(KEY) !== null) localStorage.removeItem(KEY);
      return p;
    }, undefined),
  saveProfile: (p: CompanyProfile) =>
    safe(() => localStorage.setItem(KEY, JSON.stringify(p)), undefined),
  clearProfile: () => safe(() => localStorage.removeItem(KEY), undefined),
  loadCase: (): SavedCase | undefined =>
    safe(() => {
      const c = parseSavedCase(localStorage.getItem(CASE_KEY));
      if (!c && localStorage.getItem(CASE_KEY) !== null) localStorage.removeItem(CASE_KEY);
      return c;
    }, undefined),
  saveCase: (c: SavedCase) =>
    safe(() => localStorage.setItem(CASE_KEY, JSON.stringify(c)), undefined),
  clearCase: () => safe(() => localStorage.removeItem(CASE_KEY), undefined),
  loadExampleId: (): string | undefined =>
    safe(() => {
      const v = ExampleId.safeParse(localStorage.getItem(EXAMPLE_KEY));
      return v.success ? v.data : undefined;
    }, undefined),
  saveExampleId: (id: string) => safe(() => localStorage.setItem(EXAMPLE_KEY, id), undefined),
  clearExampleId: () => safe(() => localStorage.removeItem(EXAMPLE_KEY), undefined),
  theme: (): "dark" | "light" | undefined =>
    safe(() => {
      const t = Theme.safeParse(localStorage.getItem(THEME_KEY));
      return t.success ? t.data : undefined;
    }, undefined),
  setTheme: (t: "dark" | "light") => safe(() => localStorage.setItem(THEME_KEY, t), undefined),
  reduceMotion: (): boolean | undefined =>
    safe(() => {
      const v = localStorage.getItem(MOTION_KEY);
      return v === null ? undefined : v === "1";
    }, undefined),
  setReduceMotion: (v: boolean) =>
    safe(() => localStorage.setItem(MOTION_KEY, v ? "1" : "0"), undefined),
};
