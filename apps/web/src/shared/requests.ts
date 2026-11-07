/**
 * 確認依頼と回答の、画面と API の契約。
 * ベンダーへは依頼メールを送り、ベンダーはメールの返信で番号を答える。担当者が返信を見て、送信箱から手で入力する。
 * 会社カルテは利用者の手元（ブラウザ）にだけあり、サーバは依頼と、入力された回答だけを持つ。
 */
import { z } from "zod";
import type { AnswerInput } from "./api.ts";

/**
 * 依頼の質問（選択肢は ID と文言だけ。status の対応はサーバ側）。
 * 選択肢の番号は並び順の 1 始まりで、依頼メール本文の番号と同じ（番号の振り方は @uchidai/llm の numberedChoices）
 */
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
  mailtoUrl: string;
  createdAt: string;
  sentVia: MailVia;
  sentAt?: string;
  sendError?: string;
  /** まとめ依頼の子（質問 1 問）なら、親（BatchView）の id。subject・text・mailtoUrl は親の文面を使うので空 */
  parentId?: string;
  /** 依頼文を書いたのが Claude かテンプレートか */
  writer: "claude" | "template";
  /** 返信してきたベンダー側の回答者（返信に書かれていた名前）。AnswerInput.answeredBy と同じ */
  answeredBy?: string;
  /** 返信メールを受け取った日時（ISO）。AnswerInput.answeredAt と同じ */
  answeredAt?: string;
  /** 返信の内容を送信箱に入力した担当者（古い保存データには無い） */
  enteredBy?: string;
  /** 入力した日時（ISO。古い保存データには無い） */
  enteredAt?: string;
  answer?: { choice: string; choiceLabelJa: string; input: AnswerInput };
};

/**
 * まとめ依頼の親（1 通のメール）。質問は子の依頼（RequestView。parentId が親を指す）として別に持つ。
 * 親と子は同じ profileId・to・companyLabel を持つ。文面はテンプレートだけ（Claude は呼ばない）
 */
export type BatchView = {
  id: string;
  kind: "batch";
  profileId?: string;
  companyLabel: string;
  to?: string;
  subject: string;
  text: string;
  mailtoUrl: string;
  createdAt: string;
  sentVia: MailVia;
  sentAt?: string;
  sendError?: string;
  writer: "template";
  /** 質問の順（メール本文の「■ 質問 k／N」と同じ） */
  childIds: string[];
};

/** GET /api/requests：1 項目 1 依頼と、まとめ依頼の子は items、まとめ依頼の親は batches */
export type RequestList = { items: RequestView[]; batches: BatchView[] };

/** まとめ依頼の最大の質問数 */
export const MAX_BATCH_ITEMS = 10;

/** SSE の answer イベント（返信の入力） */
export type AnswerEvent = {
  requestId: string;
  profileId?: string;
  assetLabel: string;
  choiceLabelJa: string;
  answer: AnswerInput;
};

/** SSE の retract イベント（回答の取り消し。判定からも外す） */
export type RetractEvent = {
  requestId: string;
  profileId?: string;
  assetId: string;
  mitigation: string;
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
export type ProfileExcerpt = z.infer<typeof ProfileExcerpt>;
export const CreateRequest = z.object({
  profile: ProfileExcerpt,
  assetId: z.string().max(100),
  mitigation: z.string().regex(/^(M\d{4}|UD-\d{2})$/),
  /** 宛先。1 件のメールアドレスの形だけ（複数宛先や改行は受け付けない。SEC-007） */
  to: z.string().max(200).email("宛先は 1 件のメールアドレスの形で入力してください").optional(),
  /** 回答の希望期限（省略時は 7 日後） */
  deadline: z.string().max(40).optional(),
  /** 依頼文の書き手を固定する（既定：キーがあれば Claude、無ければテンプレート） */
  writer: z.enum(["claude", "template"]).optional(),
});
export type CreateRequest = z.infer<typeof CreateRequest>;

/** POST /api/requests/:id/reply：担当者が、ベンダーの返信メールの内容を入力する */
export const ReplyRequest = z.object({
  /** 選んだ選択肢の ID（画面は番号で見せ、ID に直して送る） */
  choice: z.string().min(1).max(40),
  /** 返信に書かれていたご回答者のお名前（ベンダー側） */
  repliedBy: z.string().trim().min(1).max(80),
  /** 返信メールを受け取った日時（ISO 8601） */
  receivedAt: z.string().max(40),
  /** 入力している担当者の名前 */
  enteredBy: z.string().trim().max(80).optional(),
});
export type ReplyRequest = z.infer<typeof ReplyRequest>;

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

/** まとめ依頼の 1 項目 */
export const BatchItemInput = z.object({
  assetId: z.string().max(100),
  mitigation: z.string().regex(/^(M\d{4}|UD-\d{2})$/),
});
export type BatchItemInput = z.infer<typeof BatchItemInput>;

/**
 * POST /api/requests/batch/preview と POST /api/requests/batch：同じ要求。
 * items は (assetId, mitigation) の重複を除いて 1〜10 件。宛先は 1 件のメールアドレスの形だけ
 */
export const BatchRequestBody = z.object({
  profile: ProfileExcerpt,
  items: z.array(BatchItemInput).min(1).max(100),
  to: z.string().max(200).email("宛先は 1 件のメールアドレスの形で入力してください").optional(),
  deadline: z.string().max(40).optional(),
  /** プレビューで見せた本文。作るときに、いまの本文と違えば 409（見た文面と送る文面を同じにする） */
  expectText: z.string().max(60_000).optional(),
});
export type BatchRequestBody = z.infer<typeof BatchRequestBody>;

export type BatchPreviewView = {
  to?: string;
  subject: string;
  text: string;
  mailtoUrl: string;
  /** 本文に入れた期限。作るときにそのまま返すと、同じ文面になる */
  deadline: string;
  items: {
    assetId: string;
    assetLabel: string;
    mitigation: string;
    mitigationLabelJa: string;
    questionJa: string;
  }[];
};

/** POST /api/requests/batch/:id/reply：入力した質問の分だけ送る（回答者名と受領日時は 1 回） */
export const BatchReplyRequest = z.object({
  answers: z
    .array(
      z.object({
        requestId: z.string().min(1).max(100),
        choice: z.string().min(1).max(40),
      }),
    )
    .min(1)
    .max(MAX_BATCH_ITEMS),
  repliedBy: z.string().trim().min(1).max(80),
  receivedAt: z.string().max(40),
  enteredBy: z.string().trim().max(80).optional(),
});
export type BatchReplyRequest = z.infer<typeof BatchReplyRequest>;
