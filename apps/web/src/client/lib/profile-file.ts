/**
 * 会社カルテの JSON の書き出しと読み込み。
 * 読み込みは zod で形を検証し、失敗の理由を日本語で返す。サーバには送らない。
 * engine の CompanyProfile（zod）はブラウザに持ち込めない（engine は fs を読む）ので、同じ形をここで持つ。
 * 知らない項目は残す（将来の項目や $comment を落とさない）
 *
 * 安全の約束：
 * - 大きすぎるファイル（2MB 超）と深すぎる入れ子は、JSON として読む前・直後に拒む
 * - `domainVerified` はファイルの値を信用しない（所有確認はサーバの 24 時間のメモリにしか無い）。`domain` は残す
 * - `evidence: external`／`attrEvidence: external` は「担当者が持ち込んだ事実」としてそのまま持ち込み、注記で知らせる
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
  | {
      ok: true;
      profile: CompanyProfile;
      /** 読み込んだ担当者に知らせること（外部確認の結果を持ち込んだ、所有確認を戻した、など） */
      notesJa: string[];
    }
  | { ok: false; reasonJa: string };

export const MAX_FILE_CHARS = 2_000_000;
/** 入れ子の深さの上限。カルテは 4 段（assets[].controls[].attrs）で、$comment を含めても 8 段で足りる */
export const MAX_DEPTH = 16;

/** 項目名の日本語（zod の path をそのまま出すだけでは担当者に伝わらないので添える） */
const FIELD_JA: Record<string, string> = {
  id: "ID",
  companyName: "会社名",
  fictional: "架空の会社",
  domain: "ドメイン",
  domainVerified: "所有確認",
  pattern: "業種の構成パターン",
  employees: "従業員数",
  assets: "構成要素",
  businesses: "業務",
  dailyRevenue: "1 日の売上",
  personalData: "個人情報",
  cyberInsurance: "サイバー保険",
  typicalTransferJpy: "送金の金額",
  vendor: "保守ベンダー",
  kind: "種類",
  role: "役割",
  label: "名前",
  side: "社内外",
  product: "製品名",
  version: "版",
  controls: "対策",
  attrs: "属性",
  attrEvidence: "属性の根拠",
  mitigation: "緩和策 ID",
  status: "有無",
  evidence: "根拠",
  noteJa: "補足",
  answeredBy: "回答者",
  answeredAt: "回答日時",
  name: "名前",
  assetIds: "依存する構成要素",
  manualDays: "手作業で回せる日数",
  recoveryDays: "復旧までの日数",
  recoveryDaysWithBackup: "バックアップありの復旧日数",
  affectsJa: "影響先",
  assetId: "構成要素の ID",
  descriptionJa: "説明",
  count: "件数",
  over1000: "1,000 件超",
  sensitive: "要配慮情報",
  enrolled: "加入",
  notifyWithinDays: "通知期限の日数",
  email: "メールアドレス",
};

/** path（["assets", 0, "controls", 1, "status"]）→「assets.0.controls.1.status（構成要素 1 件目の対策 2 件目の有無）」 */
export function pathJa(path: PropertyKey[]): string {
  if (path.length === 0) return "（全体）";
  const dotted = path.map(String).join(".");
  const words: string[] = [];
  for (let i = 0; i < path.length; i++) {
    const key = path[i];
    if (typeof key === "number") continue;
    const name = FIELD_JA[String(key)] ?? String(key);
    const next = path[i + 1];
    words.push(typeof next === "number" ? `${name} ${next + 1} 件目` : name);
  }
  return `${dotted}（${words.join("の")}）`;
}

/** zod の issue を日本語の一文にする（英語の既定文言を担当者に見せない） */
export function issueJa(issue: z.core.$ZodIssue): string {
  if (
    issue.input === undefined &&
    (issue.code === "invalid_type" || issue.code === "invalid_value")
  )
    return "必須の項目がありません";
  switch (issue.code) {
    case "invalid_type":
      return `型が違います（${typeJa(issue.expected)}が必要）`;
    case "invalid_value":
      return `選べる値ではありません（${issue.values.map((v) => JSON.stringify(v)).join("、")} のどれか）`;
    case "too_small":
      return issue.origin === "array"
        ? issue.message.includes("ありません")
          ? issue.message
          : `件数が足りません（${issue.minimum} 件以上）`
        : issue.origin === "string"
          ? "空にはできません"
          : `値が小さすぎます（${issue.minimum}${issue.inclusive ? " 以上" : " より大きい値"}）`;
    case "too_big":
      return `値が大きすぎます（${issue.maximum}${issue.inclusive ? " 以下" : " 未満"}）`;
    case "invalid_format":
      return /[ぁ-んァ-ン一-龥]/.test(issue.message) ? issue.message : "形式が違います";
    case "unrecognized_keys":
      return `知らない項目があります（${issue.keys.join("、")}）`;
    default:
      return /[ぁ-んァ-ン一-龥]/.test(issue.message) ? issue.message : "形が違います";
  }
}

function typeJa(expected: string): string {
  const map: Record<string, string> = {
    string: "文字列",
    number: "数値",
    boolean: "真偽値",
    array: "配列",
    object: "オブジェクト",
    int: "整数",
  };
  return map[expected] ?? expected;
}

/** JSON の入れ子の深さ（配列・オブジェクトの段数）。再帰しない（深い入れ子でスタックを使い切らない） */
export function jsonDepth(value: unknown, limit = Number.POSITIVE_INFINITY): number {
  let max = 0;
  const stack: { v: unknown; d: number }[] = [{ v: value, d: 0 }];
  while (stack.length > 0) {
    const item = stack.pop();
    if (!item) break;
    const { v, d } = item;
    if (v === null || typeof v !== "object") continue;
    const depth = d + 1;
    if (depth > max) max = depth;
    if (max > limit) return max;
    for (const child of Array.isArray(v) ? v : Object.values(v)) {
      if (child !== null && typeof child === "object") stack.push({ v: child, d: depth });
    }
  }
  return max;
}

/** 読み込んだカルテに外部確認の結果（evidence / attrEvidence が external）が入っているか */
export function hasExternalEvidence(profile: CompanyProfile): boolean {
  return profile.assets.some(
    (a) =>
      a.controls.some((c) => c.evidence === "external") ||
      Object.values(a.attrEvidence).includes("external"),
  );
}

export const EXTERNAL_NOTE_JA =
  "外部確認の結果（根拠「外部確認」の項目）は、このファイルを書き出した時点のものです。所有確認はこのブラウザでやり直してください（外部確認の画面）。";

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
  if (jsonDepth(raw, MAX_DEPTH) > MAX_DEPTH)
    return {
      ok: false,
      reasonJa: `入れ子が深すぎます（${MAX_DEPTH} 段まで。カルテの JSON はこれほど深くなりません）`,
    };
  // reportInput: 欠けている項目（input が undefined）を「必須の項目がありません」と言い分けるため
  const r = ProfileFile.safeParse(raw, { reportInput: true });
  if (!r.success) {
    const issues = r.error.issues.slice(0, 3).map((i) => `${pathJa(i.path)}：${issueJa(i)}`);
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
  // 所有確認はファイルの値を信用しない（サーバの所有確認と結びついていない）。ドメインは残す
  const hadVerified = r.data.domainVerified;
  const profile = { ...r.data, domainVerified: false } as unknown as CompanyProfile;
  const notesJa: string[] = [];
  if (hadVerified || hasExternalEvidence(profile)) notesJa.push(EXTERNAL_NOTE_JA);
  return { ok: true, profile, notesJa };
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
