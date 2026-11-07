/**
 * バックアップ（カルテ＋このブラウザに覚えている設定）の書き出しと、復元（リストア）。
 * - 1 ファイル。{ app: "uchidai", format: "backup", version: 1, ... } の識別子つき
 * - カルテ単体の JSON（これまでの書き出し）も読み込める（その場合はカルテだけ置き換える）
 * - 読み込みは項目ごとに検証する。読めない項目があっても、読めた項目は復元できる
 * - サーバには送らない。サーバ側のファイル（確認依頼など）は対象外
 * - API キーや SMTP の資格情報はそもそもブラウザに無く、ファイルには入らない
 */

import { type HintStore, parseHints, personalHints } from "./choice-hints.ts";
import { kevHints, parseKevHints } from "./kevHints.ts";
import { staffName } from "./profile.ts";
import { jsonDepth, MAX_DEPTH, MAX_FILE_CHARS, parseProfileFile } from "./profile-file.ts";
import { parseReconHints, reconHints } from "./reconHints.ts";
import { parseSavedCase, storage } from "./storage.ts";
import type { CompanyProfile } from "./types.ts";

export const BACKUP_FORMAT = "backup";
export const BACKUP_VERSION = 1;

/** 復元で書き換える localStorage のキー（書き込み前の控えと、失敗時の巻き戻しに使う）。テストが各 load と突き合わせる */
export const KEYS = {
  profile: "uchidai.profile.v1",
  example: "uchidai.example.v1",
  noCompany: "uchidai.company.none.v1",
  personalHints: "uchidai.personalHints.v1",
  staffName: "uchidai.staffName.v1",
  case: "uchidai.case.v1",
  kev: "uchidai.kev.v1",
  recon: "uchidai.recon.v1",
  reconDomain: "uchidai.recon.domain",
  theme: "uchidai.theme",
  reduceMotion: "uchidai.reduceMotion",
} as const;

type SettingsFields = {
  personalHints?: HintStore;
  staffName?: string;
  case?: unknown;
  kev?: unknown;
  recon?: unknown;
  reconDomain?: string;
  theme?: "dark" | "light";
  reduceMotion?: boolean;
};

export type BackupFile = {
  app: "uchidai";
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: string;
  profile?: CompanyProfile;
  settings: SettingsFields;
};

/** 項目の日本語名（確認画面に並べる） */
const LABEL_JA: Record<keyof SettingsFields | "profile", string> = {
  profile: "会社カルテ",
  personalHints: "個人情報の件数区分と「分からない」の記録",
  staffName: "担当者名",
  case: "選んだ事例",
  kev: "既知の悪用脆弱性の突き合わせの記録",
  recon: "外部確認の記録",
  reconDomain: "外部確認のドメイン",
  theme: "画面の色",
  reduceMotion: "動きを減らす設定",
};

export type RestoreItem = { key: keyof SettingsFields | "profile"; labelJa: string };

export type ParsedBackup =
  | {
      ok: true;
      /** "backup"＝このバックアップの形式、"profile"＝カルテ単体の JSON（旧形式） */
      kind: "backup" | "profile";
      exportedAt?: string | undefined;
      profile?: CompanyProfile | undefined;
      settings: SettingsFields;
      /** 復元できる項目 */
      items: RestoreItem[];
      /** 読めなかった項目と理由 */
      skipped: { labelJa: string; reasonJa: string }[];
      notesJa: string[];
    }
  | { ok: false; reasonJa: string };

const pad = (n: number) => String(n).padStart(2, "0");
const dateStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function backupFileName(now: Date): string {
  return `ウチダイ-バックアップ-${dateStr(now)}.json`;
}

/** いま覚えている内容からバックアップを作る（ブラウザの保存を読む） */
export function buildBackup(profile: CompanyProfile | undefined, now: Date): BackupFile {
  const settings: SettingsFields = {};
  const hints = personalHints.load();
  if (Object.keys(hints).length > 0) settings.personalHints = hints;
  const staff = staffName.load();
  if (staff) settings.staffName = staff;
  const c = storage.loadCase();
  if (c) settings.case = c;
  const kev = kevHints.load();
  if (kev) settings.kev = kev;
  const recon = reconHints.load();
  if (recon) settings.recon = recon;
  const domain = reconHints.domain();
  if (domain) settings.reconDomain = domain;
  const theme = storage.theme();
  if (theme) settings.theme = theme;
  const motion = storage.reduceMotion();
  if (motion !== undefined) settings.reduceMotion = motion;
  return {
    app: "uchidai",
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: now.toISOString(),
    ...(profile ? { profile } : {}),
    settings,
  };
}

export function backupText(b: BackupFile): string {
  return `${JSON.stringify(b, null, 2)}\n`;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/** バックアップ（または旧形式のカルテ単体）の JSON を読む。失敗なら日本語の理由 */
export function parseBackupFile(text: string): ParsedBackup {
  if (text.length > MAX_FILE_CHARS)
    return { ok: false, reasonJa: "ファイルが大きすぎます（2MB まで）" };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reasonJa: "JSON として読めません（ファイルが壊れているか、別の形式です）" };
  }
  if (!isObject(raw)) return { ok: false, reasonJa: "バックアップの形ではありません" };
  if (jsonDepth(raw, MAX_DEPTH + 4) > MAX_DEPTH + 4)
    return { ok: false, reasonJa: "入れ子が深すぎます（バックアップはこれほど深くなりません）" };

  // 旧形式：カルテ単体
  if (raw.format !== BACKUP_FORMAT) {
    const r = parseProfileFile(text);
    if (!r.ok) return r;
    return {
      ok: true,
      kind: "profile",
      profile: r.profile,
      settings: {},
      items: [{ key: "profile", labelJa: LABEL_JA.profile }],
      skipped: [],
      notesJa: r.notesJa,
    };
  }
  if (raw.app !== "uchidai") return { ok: false, reasonJa: "ウチダイのバックアップではありません" };
  if (typeof raw.version !== "number" || raw.version > BACKUP_VERSION)
    return {
      ok: false,
      reasonJa: "このバージョンより新しい形式のバックアップです。ウチダイを更新してください",
    };

  const items: RestoreItem[] = [];
  const skipped: { labelJa: string; reasonJa: string }[] = [];
  const notesJa: string[] = [];
  const settings: SettingsFields = {};
  const take = <K extends keyof SettingsFields>(key: K, value: SettingsFields[K]) => {
    settings[key] = value;
    items.push({ key, labelJa: LABEL_JA[key] });
  };
  const skip = (key: keyof SettingsFields | "profile", reasonJa: string) =>
    skipped.push({ labelJa: LABEL_JA[key], reasonJa });

  let profile: CompanyProfile | undefined;
  if (raw.profile !== undefined) {
    const r = parseProfileFile(JSON.stringify(raw.profile));
    if (r.ok) {
      profile = r.profile;
      items.push({ key: "profile", labelJa: LABEL_JA.profile });
      notesJa.push(...r.notesJa);
    } else skip("profile", r.reasonJa);
  }

  const s = isObject(raw.settings) ? raw.settings : {};
  if (s.personalHints !== undefined) {
    if (!isObject(s.personalHints)) skip("personalHints", "形が違います");
    else {
      const h = parseHints(JSON.stringify(s.personalHints));
      if (Object.keys(h).length > 0) take("personalHints", h);
      else skip("personalHints", "読める内容がありません");
    }
  }
  if (s.staffName !== undefined) {
    if (typeof s.staffName === "string" && s.staffName.length <= 200)
      take("staffName", s.staffName);
    else skip("staffName", "文字列ではないか、長すぎます");
  }
  if (s.case !== undefined) {
    const v = parseSavedCase(JSON.stringify(s.case));
    if (v) take("case", v);
    else skip("case", "事例の形が違います");
  }
  if (s.kev !== undefined) {
    const v = parseKevHints(JSON.stringify(s.kev));
    if (v) take("kev", v);
    else skip("kev", "形が違います");
  }
  if (s.recon !== undefined) {
    const v = parseReconHints(JSON.stringify(s.recon));
    if (v) take("recon", v);
    else skip("recon", "形が違います");
  }
  if (s.reconDomain !== undefined) {
    if (typeof s.reconDomain === "string" && s.reconDomain.length <= 253)
      take("reconDomain", s.reconDomain);
    else skip("reconDomain", "文字列ではないか、長すぎます");
  }
  if (s.theme !== undefined) {
    if (s.theme === "dark" || s.theme === "light") take("theme", s.theme);
    else skip("theme", "dark か light ではありません");
  }
  if (s.reduceMotion !== undefined) {
    if (typeof s.reduceMotion === "boolean") take("reduceMotion", s.reduceMotion);
    else skip("reduceMotion", "真偽値ではありません");
  }

  if (items.length === 0)
    return {
      ok: false,
      reasonJa:
        skipped.length > 0
          ? `復元できる項目がありません。${skipped.map((x) => `${x.labelJa}：${x.reasonJa}`).join("／")}`
          : "復元できる項目がありません（中身が空のバックアップです）",
    };
  return {
    ok: true,
    kind: "backup",
    exportedAt: typeof raw.exportedAt === "string" ? raw.exportedAt : undefined,
    profile,
    settings,
    items,
    skipped,
    notesJa,
  };
}

type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;

/**
 * 検証済みの内容をこのブラウザに書く。バックアップに無い項目は触らない。
 * 書き込みの前に控えを取り、書けなかった（容量超過など）ら元に戻して失敗を返す。
 * 画面の状態への反映は呼び出し側（再読み込み）に任せる
 */
export function applyBackup(
  p: Extract<ParsedBackup, { ok: true }>,
  store: Storage = localStorage,
): { ok: true } | { ok: false; reasonJa: string } {
  const before = new Map<string, string | null>();
  for (const k of Object.values(KEYS)) before.set(k, store.getItem(k));
  const writes: [string, string][] = [];
  if (p.profile) writes.push([KEYS.profile, JSON.stringify(p.profile)]);
  const s = p.settings;
  if (s.personalHints) writes.push([KEYS.personalHints, JSON.stringify(s.personalHints)]);
  if (s.staffName !== undefined) writes.push([KEYS.staffName, s.staffName]);
  if (s.case) writes.push([KEYS.case, JSON.stringify(s.case)]);
  if (s.kev) writes.push([KEYS.kev, JSON.stringify(s.kev)]);
  if (s.recon) writes.push([KEYS.recon, JSON.stringify(s.recon)]);
  if (s.reconDomain !== undefined) writes.push([KEYS.reconDomain, s.reconDomain]);
  if (s.theme) writes.push([KEYS.theme, s.theme]);
  if (s.reduceMotion !== undefined) writes.push([KEYS.reduceMotion, s.reduceMotion ? "1" : "0"]);
  try {
    for (const [k, v] of writes) {
      store.setItem(k, v);
      if (store.getItem(k) !== v) throw new Error("not stored");
    }
    if (p.profile) {
      // 自社のカルテとして使う（選んでいた架空の会社や「未選択」の印は外す）
      store.removeItem(KEYS.example);
      store.removeItem(KEYS.noCompany);
    }
    return { ok: true };
  } catch {
    for (const [k, v] of before) {
      try {
        if (v === null) store.removeItem(k);
        else store.setItem(k, v);
      } catch {
        // 巻き戻せない場合でも続ける
      }
    }
    return {
      ok: false,
      reasonJa:
        "このブラウザに保存できませんでした（保存の容量が足りないか、保存が禁止されています）。元の状態に戻しました",
    };
  }
}
