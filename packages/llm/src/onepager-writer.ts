/**
 * 社長向けの一枚の「何が起きるか」を Claude に言い換えさせる。
 *
 * Claude に渡すのは役割名と数値だけ（製品名・バージョン・社名・ID は渡さない）。
 * 出力は zod で検証し、ID や入力にない数値が混じっていれば捨てて、engine のテンプレート文に戻す。
 * 判定と計算はしない。文章の言い換えだけ。
 */
import type Anthropic from "@anthropic-ai/sdk";
import {
  type Knowledge,
  type OnePager,
  StepState,
  type Verdict,
  VerdictResult,
} from "@uchidai/engine";
import { z } from "zod";
import { callStructured, type LlmOptions, type StructuredResult } from "./client.ts";

export const WriterStage = z.object({
  /** 型紙の段階の見出し（例：入口から侵入） */
  labelJa: z.string(),
  /** 役割の枠の日本語（例：VPN装置、管理者アカウント）。会社固有の製品名は含めない */
  roleJa: z.string(),
  state: StepState,
});
export const OnePagerWriterInput = z.object({
  result: VerdictResult,
  stages: z.array(WriterStage),
  stopped: z.array(
    z.object({
      name: z.string(),
      days: z.number(),
      manualDays: z.number(),
      affectsJa: z.string().optional(),
    }),
  ),
  downtimeDays: z.number(),
  partnerImpactDay: z.number().optional(),
  revenueImpactJpy: z.number().optional(),
  moneyLossJpy: z.number().optional(),
  reportRequired: z.boolean(),
  /** 到達した個人情報の説明（例：取引先担当者の連絡先） */
  personalDataJa: z.array(z.string()),
});
export const OnePagerWriterOutput = z.object({
  whatHappensJa: z.array(z.string().min(1).max(200)).min(1).max(5),
});
export type WriterStage = z.infer<typeof WriterStage>;
export type OnePagerWriterInput = z.infer<typeof OnePagerWriterInput>;
export type OnePagerWriterOutput = z.infer<typeof OnePagerWriterOutput>;

export const onePagerWriterJsonSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    whatHappensJa: {
      type: "array",
      description: "社長向けの短い文。2〜4 文。各要素が一文",
      items: { type: "string" },
    },
  },
  required: ["whatHappensJa"],
  additionalProperties: false,
};

/** Verdict から Claude に渡す入力を作る（役割名と数値だけ） */
export function writerInputFrom(
  verdict: Verdict,
  knowledge: Pick<Knowledge, "roles">,
): OnePagerWriterInput {
  const path =
    verdict.paths.find((p) => p.reachedCore && p.source !== "ai") ??
    verdict.paths.find((p) => p.source !== "ai") ??
    verdict.paths[0];
  const roleJa = (role: string) => knowledge.roles.find((r) => r.id === role)?.labelJa ?? role;
  const stages: WriterStage[] = (path?.steps ?? [])
    .filter((s) => !s.precondition)
    .map((s) => ({ labelJa: s.labelJa ?? s.role, roleJa: roleJa(s.role), state: s.state }));
  const { impact } = verdict;
  return OnePagerWriterInput.parse({
    result: verdict.result,
    stages,
    stopped: impact.stopped.map((s) => ({
      name: s.name,
      days: s.days,
      manualDays: s.manualDays,
      ...(s.affectsJa ? { affectsJa: s.affectsJa } : {}),
    })),
    downtimeDays: impact.downtimeDays,
    ...(impact.partnerImpactDay !== undefined ? { partnerImpactDay: impact.partnerImpactDay } : {}),
    ...(impact.revenueImpactJpy !== undefined ? { revenueImpactJpy: impact.revenueImpactJpy } : {}),
    ...(impact.moneyLossJpy !== undefined ? { moneyLossJpy: impact.moneyLossJpy } : {}),
    reportRequired: impact.reportRequired,
    personalDataJa: impact.personalDataReached.map((p) => p.descriptionJa),
  });
}

export const WRITER_RULES_JA = `あなたは、中小企業の社長に向けて説明文を書く書き手です。与えられた判定結果（役割名と数値だけ）を、社長がそのまま読める短い日本語の文にします。

## 絶対に守ること
- 数値（日数、金額、人数）は入力にあるものだけを、そのままの値で使う。新しい数値、期限、確率、割合を作らない
- 専門用語、英字の略語、ID（例：T1190、M1032）は使わない。入力にある役割名と業務名はそのまま使ってよい
- 攻撃の段階は入力の順番どおりに「どこから入り、どこへ進み、何が止まるか」として書く。state が blocked の段階があれば、そこで止まることを書く。unknown は「確認が取れていない」、human は「人の判断にかかっている」と書く
- result が breached なら、止まる業務と復旧までの日数、取引先への影響が出る日、売上への影響、個人情報の報告が必要になるかを、入力にある分だけ書く。無いものは書かない
- 一文は 70 字以内。2〜4 文。敬体（です・ます）。煽らず、断定は入力の範囲内で
- 出力は JSON スキーマどおり。文章はすべて日本語`;

const ID_PATTERN = /\bT\d{4}(?:\.\d{3})?\b|\bM\d{4}\b|UD-\d{2}|TA\d{4}/;

/** 入力の数値から、出力に現れてよい数字の集合を作る（円は万・億の表記も） */
export function allowedNumbers(input: OnePagerWriterInput): Set<string> {
  const out = new Set<string>();
  const add = (v: number | undefined) => {
    if (v === undefined) return;
    out.add(String(v));
    out.add(v.toLocaleString("ja-JP"));
  };
  const yen = (v: number | undefined) => {
    if (v === undefined) return;
    add(v);
    if (v >= 10_000) add(Math.round(v / 10_000));
    if (v >= 100_000_000) {
      const oku = v / 100_000_000;
      add(Math.round(oku));
      add(Math.round(oku * 10) / 10);
      const rest = Math.round((v % 100_000_000) / 10_000);
      if (rest > 0) add(rest);
    }
  };
  add(input.downtimeDays);
  add(input.partnerImpactDay);
  for (const s of input.stopped) {
    add(s.days);
    add(s.manualDays);
  }
  yen(input.revenueImpactJpy);
  yen(input.moneyLossJpy);
  return out;
}

/** 出力に ID や入力にない数字が混じっていないか。問題があれば理由を返す */
export function checkWriterOutput(
  output: OnePagerWriterOutput,
  input: OnePagerWriterInput,
): string | undefined {
  const allowed = allowedNumbers(input);
  for (const line of output.whatHappensJa) {
    if (ID_PATTERN.test(line)) return `ID が含まれています：${line}`;
    const normalized = line.replace(/[０-９]/g, (c) =>
      String.fromCharCode(c.charCodeAt(0) - 0xfee0),
    );
    for (const m of normalized.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
      const num = m[0];
      if (!allowed.has(num) && !allowed.has(num.replace(/,/g, "")))
        return `入力にない数値が含まれています：${num}（${line}）`;
    }
  }
  return undefined;
}

export type WriteResult = StructuredResult<OnePagerWriterOutput> & {
  /** 検証で捨てた理由。undefined なら採用できる */
  rejectedReason?: string;
};

/** Claude に言い換えを頼む。検証に落ちた場合も結果は返す（rejectedReason つき） */
export async function writeOnePagerText(
  input: OnePagerWriterInput,
  options: LlmOptions = {},
): Promise<WriteResult> {
  const system: Anthropic.TextBlockParam[] = [{ type: "text", text: WRITER_RULES_JA }];
  const r = await callStructured<OnePagerWriterOutput>(
    { maxTokens: 1500, effort: "low", ...options },
    {
      system,
      user: `<verdict>\n${JSON.stringify(OnePagerWriterInput.parse(input), null, 1)}\n</verdict>\n\n上の判定結果を、社長向けの文にしてください。`,
      schema: onePagerWriterJsonSchema,
      parse: (v) => OnePagerWriterOutput.parse(v),
    },
  );
  const rejectedReason = checkWriterOutput(r.value, input);
  return rejectedReason ? { ...r, rejectedReason } : r;
}

/** 一枚の whatHappensJa を Claude の文に差し替える（検証に落ちたら元のまま） */
export function applyWriterOutput(onePager: OnePager, result: WriteResult): OnePager {
  if (result.rejectedReason) return onePager;
  return { ...onePager, whatHappensJa: result.value.whatHappensJa };
}
