/** 会社カルテの保存先はブラウザの localStorage だけ */
import type { CompanyProfile } from "./types.ts";

const KEY = "uchidai.profile.v1";
const THEME_KEY = "uchidai.theme";
const MOTION_KEY = "uchidai.reduceMotion";

const safe = <T>(fn: () => T, fallback: T): T => {
  try {
    return fn();
  } catch {
    return fallback;
  }
};

export const storage = {
  loadProfile: (): CompanyProfile | undefined =>
    safe(() => {
      const raw = localStorage.getItem(KEY);
      return raw ? (JSON.parse(raw) as CompanyProfile) : undefined;
    }, undefined),
  saveProfile: (p: CompanyProfile) =>
    safe(() => localStorage.setItem(KEY, JSON.stringify(p)), undefined),
  clearProfile: () => safe(() => localStorage.removeItem(KEY), undefined),
  theme: (): "dark" | "light" | undefined =>
    safe(
      () => (localStorage.getItem(THEME_KEY) as "dark" | "light" | null) ?? undefined,
      undefined,
    ),
  setTheme: (t: "dark" | "light") => safe(() => localStorage.setItem(THEME_KEY, t), undefined),
  reduceMotion: (): boolean | undefined =>
    safe(() => {
      const v = localStorage.getItem(MOTION_KEY);
      return v === null ? undefined : v === "1";
    }, undefined),
  setReduceMotion: (v: boolean) =>
    safe(() => localStorage.setItem(MOTION_KEY, v ? "1" : "0"), undefined),
};
