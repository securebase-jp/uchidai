/**
 * 社長向けの一枚の共有リンク：一枚の内容（OnePager の JSON）を圧縮して URL のフラグメントに載せる。
 *
 *   #/onepager?d=<base64url(deflate(JSON))>
 *
 * - サーバには何も保存しない。開く側はこの文字列だけから一枚を描く（スマホでも、会社カルテが無くても開ける）
 * - 載せるのは一枚の内容（結論、何が起きるか、止まる業務、金額、期限、対策、出典、注記）と作成日時だけ。
 *   会社カルテと構成グラフ（弱点の地図）は載せない。URL は数 KB に収まる
 * - 圧縮はブラウザ標準の CompressionStream（deflate）。ライブラリは足さない
 * - 開くときは zod で検証し、壊れていれば日本語の理由を返す（画面が落ちない）
 * - 内容が URL に含まれるので、社外に送るときは中身に注意する（画面に注記を出す）
 */
import { z } from "zod";
import type { OnePagerResponse } from "./api.ts";
import type { OnePager } from "./types.ts";

export const SHARE_VERSION = 1;

// engine の OnePager（packages/engine/src/onepager.ts）と同じ形をブラウザ側で検証する。
// engine の zod はブラウザに持ち込まない（engine は fs を読む）ので、ここに写しを置く。
// 形が合っているかは asOnePager / toSharedOnePager の型の一致で検査する
const VerdictResult = z.enum([
  "blocked",
  "mitigated",
  "breached",
  "pending",
  "no_entry",
  "out_of_scope",
]);
const SharedStopped = z.object({
  name: z.string(),
  days: z.number(),
  manualDays: z.number(),
  partnerDay: z.number().optional(),
  affectsJa: z.string().optional(),
});
const SharedDeadline = z.object({
  day: z.number(),
  kind: z.enum(["legal", "insurance", "partner", "police", "money"]),
  labelJa: z.string(),
  sourceJa: z.string().optional(),
  deadlineId: z.string().optional(),
});
const SharedMeasure = z.object({
  id: z.string(),
  labelJa: z.string(),
  stageJa: z.string().optional(),
  requestToJa: z.string().optional(),
  basis: z.enum(["ipa", "quote", "internal"]),
  costJa: z.string(),
  costJpy: z.number().optional(),
  costSourceJa: z.string().optional(),
});
export const SharedOnePager = z.object({
  companyName: z.string(),
  fictional: z.boolean(),
  caseTitle: z.string(),
  result: VerdictResult,
  headlineJa: z.string(),
  whatHappensJa: z.array(z.string()),
  stopped: z.array(SharedStopped),
  downtimeDays: z.number(),
  partnerImpactDay: z.number().optional(),
  partnerImpactJa: z.string().optional(),
  revenueImpactJpy: z.number().optional(),
  revenueImpactJa: z.string().optional(),
  moneyLossJpy: z.number().optional(),
  moneyLossJa: z.string().optional(),
  deadlines: z.array(SharedDeadline),
  measures: z.array(SharedMeasure),
  sources: z.array(z.string()),
  notesJa: z.array(z.string()),
});
export type SharedOnePager = z.infer<typeof SharedOnePager>;

/** 写しの形が engine の OnePager と一致していることを、型の代入で検査する（両方向） */
export const asOnePager = (p: SharedOnePager): OnePager => p;
export const toSharedOnePager = (p: OnePager): SharedOnePager => p;

export const SharePayload = z.object({
  v: z.literal(SHARE_VERSION),
  onePager: SharedOnePager,
  text: z.object({
    source: z.enum(["claude", "template"]),
    model: z.string().optional(),
    noteJa: z.string().optional(),
  }),
  /** 入れた対策（ボタン）の名前。一枚の見出しに出す */
  appliedJa: z.array(z.string()),
  attackVersion: z.string(),
  /** 一枚を作った日時（ISO 8601） */
  generatedAt: z.string(),
});
export type SharePayload = z.infer<typeof SharePayload>;

/** API の応答から、リンクに載せる分だけを取り出す */
export function sharePayloadFrom(data: OnePagerResponse, now: Date = new Date()): SharePayload {
  return {
    v: SHARE_VERSION,
    onePager: toSharedOnePager(data.onePager),
    text: {
      source: data.text.source,
      ...(data.text.model ? { model: data.text.model } : {}),
      ...(data.text.noteJa ? { noteJa: data.text.noteJa } : {}),
    },
    appliedJa: data.measures.map((m) => m.labelJa),
    attackVersion: data.verdict.attackVersion,
    generatedAt: now.toISOString(),
  };
}

/** このブラウザで共有リンクを作れるか（CompressionStream があるか） */
export function supportsShare(): boolean {
  return typeof CompressionStream !== "undefined" && typeof DecompressionStream !== "undefined";
}

async function pump(bytes: Uint8Array, stream: CompressionStream | DecompressionStream) {
  const piped = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(piped).arrayBuffer());
}
const deflate = (bytes: Uint8Array) => pump(bytes, new CompressionStream("deflate"));
const inflate = (bytes: Uint8Array) => pump(bytes, new DecompressionStream("deflate"));

export function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  // 引数の数の上限に当たらないよう、少しずつ文字列にする
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export const BASE64URL = /^[A-Za-z0-9_-]+$/;

export function fromBase64Url(text: string): Uint8Array | undefined {
  if (!BASE64URL.test(text)) return undefined;
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  try {
    const bin = atob(padded);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return undefined;
  }
}

/** 一枚の内容を、URL の d= に載せる文字列にする */
export async function encodeShare(payload: SharePayload): Promise<string> {
  const json = JSON.stringify(SharePayload.parse(payload));
  return toBase64Url(await deflate(new TextEncoder().encode(json)));
}

export type ShareDecodeResult =
  | { ok: true; payload: SharePayload }
  | { ok: false; reasonJa: string };

/** URL の d= を一枚の内容に戻す。壊れていれば日本語の理由 */
export async function decodeShare(d: string): Promise<ShareDecodeResult> {
  const bytes = fromBase64Url(d);
  if (!bytes || bytes.length === 0)
    return {
      ok: false,
      reasonJa: "共有リンクの文字列が壊れています（読み取れない文字があります）。",
    };
  let json: string;
  try {
    json = new TextDecoder("utf-8", { fatal: true }).decode(await inflate(bytes));
  } catch {
    return {
      ok: false,
      reasonJa:
        "共有リンクの内容を展開できませんでした。リンクが途中で切れていないか確かめてください。",
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, reasonJa: "共有リンクの内容を読めませんでした（JSON ではありません）。" };
  }
  const version = z.object({ v: z.number() }).safeParse(parsed);
  if (version.success && version.data.v !== SHARE_VERSION)
    return {
      ok: false,
      reasonJa: `この共有リンクは対応していない形式（v=${version.data.v}）です。新しい版のウチダイで作り直してください。`,
    };
  const result = SharePayload.safeParse(parsed);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue?.path.map(String).join(".") || "（全体）";
    return {
      ok: false,
      reasonJa: `一枚の内容の形が違います：${where}：${issue?.message ?? "不明"}`,
    };
  }
  return { ok: true, payload: result.data };
}

export function buildShareHash(d: string): string {
  return `#/onepager?d=${d}`;
}

/** URL の長さの注記（数 KB になる。内容が URL に含まれる） */
export function shareSizeNoteJa(urlLength: number): string {
  const kb = Math.max(0.1, Math.round(urlLength / 100) / 10);
  return `リンクは約 ${kb} KB（${urlLength.toLocaleString("ja-JP")} 文字）です。一枚の内容がそのまま URL に入っているので、社外に送るときは中身を確かめてください。`;
}
