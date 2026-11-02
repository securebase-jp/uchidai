/**
 * 会社カルテの JSON の書き出しと読み込み。
 * 読み込みは zod で形を検証し、失敗の理由を日本語で返す。サーバには送らない。
 * engine の CompanyProfile（zod）はブラウザに持ち込めない（engine は fs を読む）ので、同じ形をここで持つ。
 * 知らない項目は残す（将来の項目や $comment を落とさない）
 */
import { z } from "zod";
import type { CompanyProfile } from "./types.ts";

const MitigationId = z.string().regex(/^(M\d{4}|UD-\d{2})$/, "緩和策 ID の形が違います");
const Evidence = z.enum(["external", "vendor", "registered", "none"]);
const Status = z.enum(["present", "absent", "unknown"]);
const AttrValue = z.union([z.string(), z.number(), z.boolean()]);

const Control = z.looseObject({
  mitigation: MitigationId,
  status: Status,
  evidence: Evidence,
  noteJa: z.string().optional(),
  answeredBy: z.string().optional(),
  answeredAt: z.string().optional(),
});
const Asset = z.looseObject({
  id: z.string().min(1),
  kind: z.enum(["device", "system", "person", "account"]),
  role: z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/, "役割の形が違います"),
  label: z.string(),
  side: z.enum(["internal", "external", "person"]).optional(),
  product: z.string().optional(),
  version: z.string().optional(),
  controls: z.array(Control).default([]),
  attrs: z.record(z.string(), AttrValue).default({}),
  attrEvidence: z.record(z.string(), Evidence).default({}),
});
const Business = z.looseObject({
  id: z.string().min(1),
  name: z.string(),
  assetIds: z.array(z.string()),
  manualDays: z.number().nonnegative(),
  recoveryDays: z.number().nonnegative(),
  recoveryDaysWithBackup: z.number().nonnegative().optional(),
  affectsJa: z.string().optional(),
});
const PersonalData = z.looseObject({
  assetId: z.string(),
  descriptionJa: z.string(),
  count: z.number().int().nonnegative().optional(),
  over1000: z.boolean(),
  sensitive: z.boolean(),
});

export const ProfileFile = z.looseObject({
  id: z.string().min(1),
  companyName: z.string(),
  fictional: z.boolean().default(false),
  domain: z.string().optional(),
  domainVerified: z.boolean().default(false),
  pattern: z.enum(["manufacturing", "office", "healthcare"]),
  employees: z.number().int().positive().optional(),
  assets: z.array(Asset).min(1, "資産が 1 つもありません"),
  businesses: z.array(Business),
  dailyRevenue: z.number().nonnegative().optional(),
  personalData: z.array(PersonalData).default([]),
  cyberInsurance: z
    .object({ enrolled: z.boolean(), notifyWithinDays: z.number().int().positive().optional() })
    .optional(),
  typicalTransferJpy: z.number().nonnegative().optional(),
  vendor: z.object({ name: z.string(), email: z.string().optional() }).optional(),
});

export type ParsedProfileFile =
  | { ok: true; profile: CompanyProfile }
  | { ok: false; reasonJa: string };

const MAX_FILE_CHARS = 2_000_000;

/** JSON の文字列をカルテとして読む。失敗なら日本語の理由 */
export function parseProfileFile(text: string): ParsedProfileFile {
  if (text.length > MAX_FILE_CHARS)
    return { ok: false, reasonJa: "ファイルが大きすぎます（2MB まで）" };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reasonJa: "JSON として読めません（ファイルが壊れているか、別の形式です）" };
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw))
    return { ok: false, reasonJa: "カルテの形ではありません（オブジェクトではない）" };
  const r = ProfileFile.safeParse(raw);
  if (!r.success) {
    const issues = r.error.issues.slice(0, 3).map((i) => {
      const path = i.path.map(String).join(".") || "(全体)";
      return `${path}：${i.message}`;
    });
    return {
      ok: false,
      reasonJa: `カルテの形が違います。${issues.join("／")}${r.error.issues.length > 3 ? " ほか" : ""}`,
    };
  }
  // 業務が依存する資産や個人情報の資産がカルテに無ければ知らせる（判定のグラフから落ちる）
  const ids = new Set(r.data.assets.map((a) => a.id));
  const missing = [
    ...r.data.businesses.flatMap((b) => b.assetIds.filter((id) => !ids.has(id))),
    ...r.data.personalData.map((p) => p.assetId).filter((id) => !ids.has(id)),
  ];
  if (missing.length > 0)
    return {
      ok: false,
      reasonJa: `カルテに無い資産を参照しています：${[...new Set(missing)].join("、")}`,
    };
  return { ok: true, profile: r.data as unknown as CompanyProfile };
}

/** 書き出すファイル名：ウチダイ-カルテ-<会社名>-<日付>.json（ファイル名に使えない文字は除く） */
export function exportFileName(profile: CompanyProfile, now: Date): string {
  const name = profile.companyName
    .replace(/[\\/:*?"<>|\s　]+/g, "")
    .replace(/[\p{Cc}]/gu, "")
    .slice(0, 40);
  const d = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return `ウチダイ-カルテ-${name || "会社"}-${d}.json`;
}

/** 書き出す本文（整形した JSON。id や fictional もそのまま） */
export function exportText(profile: CompanyProfile): string {
  return `${JSON.stringify(profile, null, 2)}\n`;
}
