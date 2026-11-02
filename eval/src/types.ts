import { z } from "zod";

/** ATT&CK の ID 形式。存在確認は engine 側で公式データと照合する */
export const TacticId = z.string().regex(/^TA\d{4}$/, "戦術IDは TA0000 の形式");
export const TechniqueId = z
  .string()
  .regex(/^T\d{4}(\.\d{3})?$/, "手法IDは T0000 または T0000.000 の形式");

export const DamageType = z.enum(["ransomware", "bec", "data_breach", "out_of_scope"]);
export const Clarity = z.enum(["clear", "partial", "unknown"]);
export const StepSource = z.enum(["stated", "inferred", "unknown"]);
export const VerdictResult = z.enum(["blocked", "mitigated", "breached", "pending"]);

/** Claude の読解結果（packages/llm の出力と同じ形。ここでは採点に必要な部分だけ） */
export const CaseStepSchema = z.object({
  tactic: TacticId,
  techniques: z.array(TechniqueId),
  source: StepSource,
  quote: z.string().optional(),
});
export const CaseOutputSchema = z.object({
  damageType: DamageType,
  clarity: Clarity,
  steps: z.array(CaseStepSchema),
});
export type CaseOutput = z.infer<typeof CaseOutputSchema>;
export type CaseStep = z.infer<typeof CaseStepSchema>;

/** 正解データの1段階。techniques は「正解として認める ID」の集合（いずれかに一致すれば正解） */
export const GoldStepSchema = z.object({
  label: z.string(),
  tactic: TacticId,
  techniques: z.array(TechniqueId).min(1),
  source: z.enum(["stated", "inferred"]),
  /** 根拠文の照合に使う手がかり。扱い（抜粋の保持方法）は検討中 */
  quoteHint: z.string().optional(),
});
export const GoldCaseSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(["draft", "confirmed"]),
  source: z.object({
    citation: z.string(),
    url: z.string().url(),
    pages: z.string().optional(),
    summary: z.string(),
  }),
  expected: z.object({
    damageType: DamageType,
    clarity: Clarity,
    steps: z.array(GoldStepSchema),
    /** デモ用架空企業（examples/demo-seiko）に当てはめたときの結論 */
    verdict: VerdictResult.optional(),
    /** 入口が不明な事例など、読解の検証にだけ使う事例は false */
    usedInDemo: z.boolean(),
  }),
});
export type GoldCase = z.infer<typeof GoldCaseSchema>;
export type GoldStep = z.infer<typeof GoldStepSchema>;

/** 記録した Claude の応答。リクエストヘッダは絶対に保存しない */
export const RecordingSchema = z.object({
  caseId: z.string(),
  mode: z.enum(["with-knowledge", "without-knowledge"]),
  model: z.string(),
  recordedAt: z.string(),
  note: z.string().optional(),
  output: CaseOutputSchema,
  /** engine で判定した結論（記録時点）。未実装なら省略 */
  verdict: VerdictResult.optional(),
});
export type Recording = z.infer<typeof RecordingSchema>;
