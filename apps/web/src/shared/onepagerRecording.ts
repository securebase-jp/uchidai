/**
 * デモ場面 9 の「社長向けの一枚」の記録。
 * デモ精工 × 事例 1（ipa-case-1）の一枚を、POST /api/onepager と同じ経路で、Claude の言い換えつきで一度だけ作り、
 * demo/recordings/onepager.demo-seiko.ipa-case-1.json に残す（demo/scripts/record-onepager.ts）。
 * デモモードの画面は、条件（会社・事例・対策・回答）が記録と同じときだけこの記録を即座に使い、API も Claude も呼ばない
 * （毎回同じ映像になり、言い換えを待つ骨組みの空白も出ない）。リクエストのヘッダ・API キーは保存しない。
 */
import { z } from "zod";
import type { AnswerInput } from "./api.ts";

export const ONEPAGER_RECORDING_VERSION = 1;
export const ONEPAGER_RECORDING_NOTE =
  "実際の出力の記録。デモ精工のカルテと事例 1 で、場面 5 のベンダー回答（管理者のパスワードは全 PC で共通）を入れた状態の一枚を、POST /api/onepager と同じ経路で Claude に言い換えさせたもの。リクエストヘッダは保存していない";

const Answer = z.object({
  assetId: z.string(),
  mitigation: z.string().regex(/^(M\d{4}|UD-\d{2})$/),
  status: z.enum(["present", "absent", "unknown"]),
  evidence: z.enum(["external", "vendor", "registered", "none"]),
  answeredBy: z.string(),
  answeredAt: z.string().optional(),
  noteJa: z.string().optional(),
  attrs: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});

export const OnePagerRecording = z.object({
  version: z.literal(ONEPAGER_RECORDING_VERSION),
  note: z.string(),
  recordedAt: z.string(),
  /** 言い換えを書いたモデル（Claude の実際の出力であること） */
  model: z.string(),
  profileId: z.string(),
  caseId: z.string(),
  measureIds: z.array(z.string()),
  /** 記録したときに入れていた回答（場面 5 のベンダー回答） */
  answers: z.array(Answer),
  /** 記事に入口が書かれていない事例か（画面の注記に使う。事例 1 は書かれている） */
  entryUnknown: z.boolean(),
  /** POST /api/onepager の応答そのもの。「何が起きるか」の文は Claude の言い換え */
  response: z
    .object({
      onePager: z.object({ whatHappensJa: z.array(z.string()).min(1) }).passthrough(),
      graph: z.object({}).passthrough(),
      verdict: z.object({}).passthrough(),
      measures: z.array(z.unknown()),
      profile: z.object({ id: z.string() }).passthrough(),
      text: z.object({
        source: z.literal("claude"),
        model: z.string().optional(),
        noteJa: z.string().optional(),
      }),
    })
    .passthrough(),
});
export type OnePagerRecording = z.infer<typeof OnePagerRecording>;

/** 回答の照合に使う部分（受領の時刻や入力した人は、判定に関係しないので比べない） */
const answerKey = (a: Pick<AnswerInput, "assetId" | "mitigation" | "status" | "evidence">) =>
  `${a.assetId}/${a.mitigation}/${a.status}/${a.evidence}`;

/** いまの条件が記録と同じか（同じなら、記録をそのまま使ってよい） */
export function matchesOnePagerRecording(
  rec: OnePagerRecording,
  input: {
    profileId?: string | undefined;
    caseId?: string | undefined;
    measureIds: string[];
    answers: AnswerInput[];
  },
): boolean {
  if (input.profileId !== rec.profileId || input.caseId !== rec.caseId) return false;
  if ([...input.measureIds].sort().join(",") !== [...rec.measureIds].sort().join(",")) return false;
  const a = input.answers.map(answerKey).sort().join("|");
  const b = rec.answers.map(answerKey).sort().join("|");
  return a === b;
}
