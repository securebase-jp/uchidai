/**
 * 画面と API の契約。zod で入力を検証し、型は engine の共通型を使う。
 * このファイルは値として engine を import しない（ブラウザ側でも読むため）。
 */
import { z } from "zod";

export const CaseInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("url"), url: z.string().url(), pages: z.string().optional() }),
  z.object({
    kind: z.literal("text"),
    text: z.string().min(40, "記事の本文が短すぎます"),
    title: z.string().optional(),
    sourceUrl: z.string().url().optional(),
  }),
  z.object({
    kind: z.literal("pdf"),
    dataBase64: z.string().min(1),
    pages: z.string().optional(),
    sourceUrl: z.string().url().optional(),
  }),
]);
export type CaseInput = z.infer<typeof CaseInput>;

export const ReadRequest = z.object({ input: CaseInput });
export type ReadRequest = z.infer<typeof ReadRequest>;

/** ベンダーなどの回答（applyAnswer の引数） */
export const AnswerInput = z.object({
  assetId: z.string(),
  mitigation: z.string().regex(/^(M\d{4}|UD-\d{2})$/),
  status: z.enum(["present", "absent", "unknown"]),
  evidence: z.enum(["external", "vendor", "registered", "none"]),
  answeredBy: z.string(),
  answeredAt: z.string().optional(),
  noteJa: z.string().optional(),
  attrs: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});
export type AnswerInput = z.infer<typeof AnswerInput>;

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

export type ApiError = { error: string; details?: unknown };
