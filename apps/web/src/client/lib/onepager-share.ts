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
 * - 守り：d= の長さ（64 KB）、展開後の大きさ（1 MB。展開しながら数えて途中で打ち切る）、
 *   文字列と配列の長さに上限を置く。deflate は数百倍に膨らむので、長さの検査だけでは足りない
 */
import { z } from "zod";
import type { OnePagerResponse } from "./api.ts";
import type { OnePager } from "./types.ts";

export const SHARE_VERSION = 1;

/** URL の d= の長さの上限（文字）。一枚は数 KB なので十分 */
export const MAX_SHARE_CHARS = 64 * 1024;
/** 展開後の JSON の上限（バイト）。これを超えたら展開を途中で止める */
export const MAX_INFLATED_BYTES = 1024 * 1024;
/** 文字列と配列の上限（見出し、文、配列の件数） */
export const LIMITS = { title: 300, sentence: 2_000, items: 50 } as const;

const title = (what: string) =>
  z.string().max(LIMITS.title, `${what}が長すぎます（${LIMITS.title} 文字まで）`);
const sentence = (what: string) =>
  z
    .string()
    .max(
      LIMITS.sentence,
      `${what}が長すぎます（${LIMITS.sentence.toLocaleString("ja-JP")} 文字まで）`,
    );
const list = <T extends z.ZodType>(item: T, what: string) =>
  z.array(item).max(LIMITS.items, `${what}が多すぎます（${LIMITS.items} 件まで）`);

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
  name: title("業務名"),
  days: z.number(),
  manualDays: z.number(),
  partnerDay: z.number().optional(),
  affectsJa: sentence("影響先").optional(),
});
const SharedDeadline = z.object({
  day: z.number(),
  kind: z.enum(["legal", "insurance", "partner", "police", "money"]),
  labelJa: title("期限の名前"),
  sourceJa: sentence("期限の出典").optional(),
  deadlineId: title("期限の ID").optional(),
});
const SharedMeasure = z.object({
  id: title("対策の ID"),
  labelJa: title("対策の名前"),
  stageJa: title("効く段階").optional(),
  requestToJa: title("依頼先").optional(),
  basis: z.enum(["ipa", "quote", "internal"]),
  costJa: sentence("費用の目安"),
  costJpy: z.number().optional(),
  costSourceJa: sentence("費用の出典").optional(),
});
export const SharedOnePager = z.object({
  companyName: title("会社名"),
  fictional: z.boolean(),
  caseTitle: title("事例名"),
  result: VerdictResult,
  headlineJa: title("見出し"),
  whatHappensJa: list(sentence("「何が起きるか」の文"), "「何が起きるか」の文"),
  stopped: list(SharedStopped, "止まる業務"),
  downtimeDays: z.number(),
  partnerImpactDay: z.number().optional(),
  partnerImpactJa: sentence("取引先への影響").optional(),
  revenueImpactJpy: z.number().optional(),
  revenueImpactJa: sentence("売上への影響").optional(),
  moneyLossJpy: z.number().optional(),
  moneyLossJa: sentence("流出する資金").optional(),
  deadlines: list(SharedDeadline, "期限"),
  measures: list(SharedMeasure, "対策"),
  sources: list(sentence("出典"), "出典"),
  notesJa: list(sentence("注記"), "注記"),
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
    model: title("モデル名").optional(),
    noteJa: sentence("文の注記").optional(),
  }),
  /** 入れた対策（ボタン）の名前。一枚の見出しに出す */
  appliedJa: list(title("入れた対策の名前"), "入れた対策"),
  attackVersion: title("ATT&CK の版"),
  /** 一枚を作った日時（ISO 8601） */
  generatedAt: title("作成日時"),
  /** 記事に入口が書かれておらず、型紙の入口候補で判定した一枚（省略時は false。古いリンクも開ける） */
  entryUnknown: z.boolean().optional(),
});
export type SharePayload = z.infer<typeof SharePayload>;

/** API の応答から、リンクに載せる分だけを取り出す */
export function sharePayloadFrom(
  data: OnePagerResponse,
  now: Date = new Date(),
  opts: { entryUnknown?: boolean } = {},
): SharePayload {
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
    ...(opts.entryUnknown ? { entryUnknown: true } : {}),
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

export class InflateTooLargeError extends Error {
  constructor(max: number) {
    super(`展開後の大きさが上限（${max} バイト）を超えた`);
    this.name = "InflateTooLargeError";
  }
}

/**
 * 展開しながら大きさを数え、上限を超えたら途中で止める（deflate は小さな入力が数百倍に膨らむ）。
 * 上限を超えたら InflateTooLargeError
 */
export async function inflateLimited(bytes: Uint8Array, max: number): Promise<Uint8Array> {
  const reader = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("deflate"))
    .getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > max) throw new InflateTooLargeError(max);
      chunks.push(value);
    }
  } finally {
    // 途中で止めたときは残りを捨てる（すでに閉じていれば何もしない）
    reader.cancel().catch(() => {});
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}
const inflate = (bytes: Uint8Array) => inflateLimited(bytes, MAX_INFLATED_BYTES);

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
  if (d.length > MAX_SHARE_CHARS)
    return {
      ok: false,
      reasonJa: `共有リンクが長すぎます（${Math.round(MAX_SHARE_CHARS / 1024)} KB まで。ウチダイが作る一枚のリンクは数 KB です）。`,
    };
  const bytes = fromBase64Url(d);
  if (!bytes || bytes.length === 0)
    return {
      ok: false,
      reasonJa: "共有リンクの文字列が壊れています（読み取れない文字があります）。",
    };
  let json: string;
  try {
    json = new TextDecoder("utf-8", { fatal: true }).decode(await inflate(bytes));
  } catch (e) {
    if (e instanceof InflateTooLargeError)
      return {
        ok: false,
        reasonJa: `共有リンクの内容が大きすぎます（展開後 ${Math.round(MAX_INFLATED_BYTES / 1024 / 1024)} MB まで。ウチダイが作る一枚ではありません）。`,
      };
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
