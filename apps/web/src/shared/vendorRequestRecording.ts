/**
 * デモ場面 5 の「ベンダーへの確認依頼」の記録。
 * 管理者アカウント（M1026）の依頼文（件名・番号つきの本文・選択肢）を、Claude で一度だけ実際に生成した結果として
 * demo/recordings/vendor-request.demo-seiko.json に残す。デモモードの画面はこの記録から送信箱の 1 件を組み立てる
 * （サーバにも送信箱にも依頼を作らず、Claude も呼ばない。毎回同じ映像になる）。
 * リクエストのヘッダ・API キーは保存しない。
 */
import { z } from "zod";
import type { AnswerInput } from "./api.ts";
import type { RequestView } from "./requests.ts";

export const VENDOR_REQUEST_RECORDING_VERSION = 1;
export const VENDOR_REQUEST_RECORDING_NOTE =
  "実際の出力の記録。デモ精工のカルテで、管理者アカウント（M1026）の確認依頼を Claude に書かせたもの（POST /api/requests と同じ経路）。リクエストヘッダは保存していない";

const Choice = z.object({
  id: z.string().min(1).max(40),
  labelJa: z.string().min(1).max(200),
  status: z.enum(["present", "absent", "unknown"]),
  attrs: z
    .record(z.string().max(64), z.union([z.string().max(200), z.number(), z.boolean()]))
    .optional(),
});

export const VendorRequestRecording = z.object({
  version: z.literal(VENDOR_REQUEST_RECORDING_VERSION),
  note: z.string(),
  recordedAt: z.string(),
  /** 依頼文を書いたモデル（Claude の実際の出力であること） */
  model: z.string(),
  profileId: z.string(),
  assetId: z.string(),
  mitigation: z.string().regex(/^(M\d{4}|UD-\d{2})$/),
  /** 依頼文を書いたのが Claude であること（テンプレートの文面は記録にしない） */
  writer: z.literal("claude"),
  subject: z.string().min(1),
  /** 番号つきの選択肢と、返信の書き方を含む本文 */
  text: z.string().min(1),
  mailtoUrl: z.string(),
  to: z.string().optional(),
  companyLabel: z.string(),
  assetLabel: z.string(),
  background: z.object({
    techniqueId: z.string().optional(),
    techniqueLabelJa: z.string().optional(),
    mitigationId: z.string(),
    mitigationLabelJa: z.string(),
    materialsJa: z.string().optional(),
  }),
  question: z.object({
    textJa: z.string(),
    hintJa: z.string().optional(),
    choices: z.array(z.object({ id: z.string(), labelJa: z.string() })).min(2),
  }),
  /** 選択肢 → 回答（status と属性）の対応。サーバの質問表（server/requests/questions.ts）の写し */
  choiceMap: z.array(Choice).min(2),
});
export type VendorRequestRecording = z.infer<typeof VendorRequestRecording>;

export function parseVendorRequestRecording(json: unknown): VendorRequestRecording {
  return VendorRequestRecording.parse(json);
}

/** 画面に出す依頼の id（サーバには無い。デモ専用） */
export const DEMO_REQUEST_ID = "demo-vendor-request";

/** 記録から送信箱の 1 件（回答待ち）を組み立てる。作成日時は記録した日時 */
export function requestFromRecording(rec: VendorRequestRecording): RequestView {
  return {
    id: DEMO_REQUEST_ID,
    profileId: rec.profileId,
    companyLabel: rec.companyLabel,
    assetId: rec.assetId,
    assetLabel: rec.assetLabel,
    mitigation: rec.mitigation,
    background: {
      mitigationId: rec.background.mitigationId,
      mitigationLabelJa: rec.background.mitigationLabelJa,
      ...(rec.background.techniqueId ? { techniqueId: rec.background.techniqueId } : {}),
      ...(rec.background.techniqueLabelJa
        ? { techniqueLabelJa: rec.background.techniqueLabelJa }
        : {}),
      ...(rec.background.materialsJa ? { materialsJa: rec.background.materialsJa } : {}),
    },
    question: {
      textJa: rec.question.textJa,
      ...(rec.question.hintJa ? { hintJa: rec.question.hintJa } : {}),
      choices: rec.question.choices,
    },
    ...(rec.to ? { to: rec.to } : {}),
    subject: rec.subject,
    text: rec.text,
    mailtoUrl: rec.mailtoUrl,
    createdAt: rec.recordedAt,
    sentVia: "outbox",
    writer: rec.writer,
  };
}

const JA_WHEN = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * 返信の入力（番号 → 回答）。サーバの RequestStore.recordReply と同じ形の AnswerInput を作る
 * （同じになることは demo の test が確かめる）。選択肢が無ければ undefined。
 */
export function answerFromReply(
  rec: VendorRequestRecording,
  input: { choice: string; repliedBy: string; receivedAt: string; enteredBy?: string | undefined },
): AnswerInput | undefined {
  const choice = rec.choiceMap.find((c) => c.id === input.choice);
  if (!choice) return undefined;
  const received = new Date(input.receivedAt);
  if (Number.isNaN(received.getTime())) return undefined;
  const enteredBy = input.enteredBy?.trim() || undefined;
  return {
    assetId: rec.assetId,
    mitigation: rec.mitigation,
    status: choice.status,
    evidence: "vendor",
    answeredBy: input.repliedBy.trim(),
    answeredAt: received.toISOString(),
    noteJa: `ベンダー回答：${choice.labelJa}（質問：${rec.question.textJa}）。返信メールの受領 ${JA_WHEN.format(received)}、入力：${enteredBy ?? "担当者名なし"}`,
    ...(choice.attrs ? { attrs: choice.attrs } : {}),
  };
}

/** API キーや認証ヘッダらしき文字列が記録に混ざっていないか（見つかった断片の種類を返す） */
export function findSecretLike(json: string): string[] {
  const found: string[] = [];
  if (/sk-ant-[A-Za-z0-9_-]{8,}/.test(json)) found.push("Anthropic のキー");
  if (/x-api-key|authorization\s*:/i.test(json)) found.push("認証ヘッダ");
  return found;
}
