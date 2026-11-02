/**
 * 確認依頼と回答の、画面と API の契約。
 * 会社カルテは利用者の手元（ブラウザ）にだけあり、サーバは依頼のトークンと回答だけを持つ。
 */
import { z } from "zod";
import type { AnswerInput } from "./api.ts";

/** 回答ページで見せる質問（選択肢は ID と文言だけ。status の対応はサーバ側） */
export type QuestionView = {
  textJa: string;
  hintJa?: string;
  choices: { id: string; labelJa: string }[];
};

export type RequestBackground = {
  techniqueId?: string;
  techniqueLabelJa?: string;
  mitigationId: string;
  mitigationLabelJa: string;
  materialsJa?: string;
};

export type MailVia = "outbox" | "mailto" | "smtp";

/** 送信箱に積まれた依頼（担当者画面向け） */
export type RequestView = {
  id: string;
  /** 回答リンクに使う。担当者の手元のサーバだけが持つ */
  token: string;
  profileId?: string;
  companyLabel: string;
  assetId: string;
  assetLabel: string;
  mitigation: string;
  background: RequestBackground;
  question: QuestionView;
  to?: string;
  subject: string;
  text: string;
  answerUrl: string;
  mailtoUrl: string;
  createdAt: string;
  sentVia: MailVia;
  sentAt?: string;
  sendError?: string;
  /** 依頼文を書いたのが Claude かテンプレートか */
  writer: "claude" | "template";
  answeredAt?: string;
  answeredBy?: string;
  answer?: { choice: string; choiceLabelJa: string; input: AnswerInput };
};

/** 回答ページ向け（トークンで引く。会社名と対象と質問だけ） */
export type AnswerPageView = {
  companyLabel: string;
  assetLabel: string;
  question: QuestionView;
  background: RequestBackground;
  createdAt: string;
  answered: boolean;
  answeredAt?: string;
};

/** SSE の answer イベント */
export type AnswerEvent = {
  requestId: string;
  profileId?: string;
  assetLabel: string;
  choiceLabelJa: string;
  answer: AnswerInput;
};

/** POST /api/requests：カルテは抜粋でよい（会社名、資産の id・role・label、ベンダー） */
export const ProfileExcerpt = z.object({
  id: z.string().max(64).optional(),
  companyName: z.string().max(80),
  vendor: z.object({ name: z.string().max(80), email: z.string().max(200).optional() }).optional(),
  assets: z
    .array(
      z.object({ id: z.string().max(100), role: z.string().max(100), label: z.string().max(120) }),
    )
    .max(100),
});
export const CreateRequest = z.object({
  profile: ProfileExcerpt,
  assetId: z.string().max(100),
  mitigation: z.string().regex(/^(M\d{4}|UD-\d{2})$/),
  to: z.string().max(200).optional(),
  /** 回答の希望期限（省略時は 7 日後） */
  deadline: z.string().max(40).optional(),
  /** 依頼文の書き手を固定する（既定：キーがあれば Claude、無ければテンプレート） */
  writer: z.enum(["claude", "template"]).optional(),
});
export type CreateRequest = z.infer<typeof CreateRequest>;

export const AnswerRequest = z.object({
  choice: z.string().min(1).max(40),
  answeredBy: z.string().min(1).max(80),
});
export type AnswerRequest = z.infer<typeof AnswerRequest>;

/** POST /api/requests/measure-draft：対策依頼文の下書き（送らない） */
export const MeasureDraftRequest = z.object({
  profile: ProfileExcerpt,
  measureId: z.string().max(64),
  assetId: z.string().max(100).optional(),
  deadline: z.string().max(40).optional(),
  writer: z.enum(["claude", "template"]).optional(),
});
export type MeasureDraftRequest = z.infer<typeof MeasureDraftRequest>;
export type MeasureDraftView = {
  to?: string;
  subject: string;
  text: string;
  mailtoUrl: string;
  writer: "claude" | "template";
};
