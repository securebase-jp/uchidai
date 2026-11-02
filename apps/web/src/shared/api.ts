/**
 * 画面と API の契約。zod で入力を検証し、型は engine の共通型を使う。
 * このファイルは値として engine を import しない（ブラウザ側でも読むため）。
 * 文字列と配列には上限を置く（巨大な入力でサーバを止めない）。
 */
import { z } from "zod";

/** 記事本文の上限（文字）。IPA 事例集 1 事例や長文の報道記事が十分に入る大きさ */
export const MAX_ARTICLE_CHARS = 300_000;
/** PDF（base64）の上限（文字）。llm 側の取得上限 20MB に合わせる */
export const MAX_PDF_BASE64_CHARS = 28_000_000;

export const CaseInput = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("url"),
    url: z.string().url().max(2048),
    pages: z.string().max(64).optional(),
  }),
  z.object({
    kind: z.literal("text"),
    text: z.string().min(40, "記事の本文が短すぎます").max(MAX_ARTICLE_CHARS),
    title: z.string().max(300).optional(),
    sourceUrl: z.string().url().max(2048).optional(),
  }),
  z.object({
    kind: z.literal("pdf"),
    dataBase64: z.string().min(1).max(MAX_PDF_BASE64_CHARS),
    pages: z.string().max(64).optional(),
    sourceUrl: z.string().url().max(2048).optional(),
  }),
]);
export type CaseInput = z.infer<typeof CaseInput>;

export const ReadRequest = z.object({ input: CaseInput });
export type ReadRequest = z.infer<typeof ReadRequest>;

/** ベンダーなどの回答（applyAnswer の引数） */
export const AnswerInput = z.object({
  assetId: z.string().max(100),
  mitigation: z.string().regex(/^(M\d{4}|UD-\d{2})$/),
  status: z.enum(["present", "absent", "unknown"]),
  evidence: z.enum(["external", "vendor", "registered", "none"]),
  answeredBy: z.string().max(120),
  answeredAt: z.string().max(40).optional(),
  noteJa: z.string().max(1000).optional(),
  attrs: z
    .record(z.string().max(64), z.union([z.string().max(200), z.number(), z.boolean()]))
    .optional(),
});
export type AnswerInput = z.infer<typeof AnswerInput>;

/** 対策ボタンの ID の列（/api/evaluate、/api/onepager、/api/attacker/*） */
export const MeasureIds = z.array(z.string().max(64)).max(50).default([]);
/** 回答の列（同上） */
export const Answers = z.array(AnswerInput).max(200).default([]);

/** 5問の一問（knowledge/questions.yaml の画面向けの形） */
export type QuestionOption = {
  value: string;
  labelJa: string;
};
export type Question =
  | {
      id: "industry" | "site" | "remoteAccess" | "backup";
      textJa: string;
      hintJa?: string;
      multi: boolean;
      options: QuestionOption[];
    }
  | {
      id: "hosting";
      textJa: string;
      hintJa?: string;
      multi: false;
      rows: { key: "mail" | "files" | "core" | "web"; labelJa: string }[];
      options: QuestionOption[];
    };

/**
 * 緩和策ごとの「1 問だけの選択式」の質問（server/requests/questions.ts の質問表を画面にも渡す形）。
 * 選択肢を選ぶと status と、判定ルールが参照する属性（attrs）が決まる
 */
export type ControlChoice = {
  id: string;
  labelJa: string;
  status: "present" | "absent" | "unknown";
  attrs?: Record<string, string | number | boolean>;
};
export type ControlQuestion = {
  mitigation: string;
  textJa: string;
  hintJa?: string;
  choices: ControlChoice[];
  /** 役割ごとの文言（サーバの M1047 は監査、ホームページの M1047 は改ざん検知など）。画面は資産の役割で選ぶ */
  byRole?: Record<string, { textJa: string; hintJa?: string; choices?: ControlChoice[] }>;
};

export type ApiError = { error: string; details?: unknown };
