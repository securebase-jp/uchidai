/**
 * AI攻撃者と知見なし比較の記録（eval/recordings/attacker.<profileId>.json、compare.<caseId>.json）。
 * 実際に実行した入力（抽象化カルテ）、生の出力、検証結果、モデル、日時を残す。リクエストヘッダは保存しない。
 * API キーが無いとき（デモモードを含む）はこの記録を再生する
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "@uchidai/engine";
import { z } from "zod";
import type { GenericMitigation } from "./reader.ts";

export const AttackerRecording = z.object({
  profileId: z.string(),
  model: z.string(),
  recordedAt: z.string(),
  attackVersion: z.string(),
  attackerVersion: z.string().optional(),
  note: z.string(),
  /** 何回目の実行で仕込んだ経路が見つかったか（記録は最後の実行） */
  attempts: z.number().int().positive(),
  input: z.object({ abstracted: z.unknown(), rendered: z.string() }),
  raw: z.unknown(),
  /** 安全検査・スキーマ検証を通った候補（再生時は現在のカルテで 4 点検証し直す） */
  candidates: z.array(z.unknown()),
  /** 安全検査・スキーマ検証で破棄した候補 */
  screened: z.array(z.unknown()),
  validation: z.array(
    z.object({
      titleJa: z.string().optional(),
      ok: z.boolean(),
      reasons: z.array(z.string()).optional(),
    }),
  ),
  /** 記録時点で採用された経路 */
  paths: z.array(z.unknown()),
  log: z.array(z.string()),
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }).optional(),
  previousRuns: z
    .array(
      z.object({
        recordedAt: z.string(),
        model: z.string(),
        raw: z.unknown(),
        found: z.boolean(),
      }),
    )
    .optional(),
});
export type AttackerRecording = z.infer<typeof AttackerRecording>;

export const CompareRecording = z.object({
  caseId: z.string(),
  profileId: z.string(),
  model: z.string(),
  recordedAt: z.string(),
  attackVersion: z.string(),
  note: z.string(),
  items: z.array(
    z.object({
      mitigationId: z.string().optional(),
      rejectedId: z.string().optional(),
      nameJa: z.string(),
      reasonJa: z.string(),
    }),
  ),
  raw: z.unknown(),
  counts: z.object({
    total: z.number(),
    withValidId: z.number(),
    rejectedIds: z.number(),
    withoutId: z.number(),
  }),
  /** 記録時点の振り分け（デモ用カルテに対して）。再生時は現在の判定で振り分け直す */
  classified: z.unknown(),
});
export type CompareRecording = z.infer<typeof CompareRecording>;

export const recordingsDir = join(repoRoot, "eval", "recordings");
const safe = (id: string) => /^[a-z0-9][a-z0-9-]{0,63}$/.test(id);

export function attackerRecordingPath(profileId: string): string {
  return join(recordingsDir, `attacker.${profileId}.json`);
}
export function compareRecordingPath(caseId: string): string {
  return join(recordingsDir, `compare.${caseId}.json`);
}

export function loadAttackerRecording(profileId: string): AttackerRecording | undefined {
  if (!safe(profileId)) return undefined;
  const p = attackerRecordingPath(profileId);
  if (!existsSync(p)) return undefined;
  return AttackerRecording.parse(JSON.parse(readFileSync(p, "utf8")));
}

export function toGenericMitigations(items: CompareRecording["items"]): GenericMitigation[] {
  return items.map((i) => ({
    nameJa: i.nameJa,
    reasonJa: i.reasonJa,
    ...(i.mitigationId ? { mitigationId: i.mitigationId } : {}),
    ...(i.rejectedId ? { rejectedId: i.rejectedId } : {}),
  }));
}

/** 知見なしの対策一覧の記録。compare.<caseId>.json が無ければ S1 の mitigations/<caseId>.json を使う */
export function loadCompareRecording(
  caseId: string,
): { items: GenericMitigation[]; model: string; recordedAt: string; note: string } | undefined {
  if (!safe(caseId)) return undefined;
  const p = compareRecordingPath(caseId);
  if (existsSync(p)) {
    const rec = CompareRecording.parse(JSON.parse(readFileSync(p, "utf8")));
    return {
      items: toGenericMitigations(rec.items),
      model: rec.model,
      recordedAt: rec.recordedAt,
      note: rec.note,
    };
  }
  const legacy = join(recordingsDir, "mitigations", `${caseId}.json`);
  if (!existsSync(legacy)) return undefined;
  const rec = CompareRecording.pick({ items: true, model: true, recordedAt: true })
    .extend({ note: z.string().optional() })
    .parse(JSON.parse(readFileSync(legacy, "utf8")));
  return {
    items: toGenericMitigations(rec.items),
    model: rec.model,
    recordedAt: rec.recordedAt,
    note: rec.note ?? "知見なしの対策一覧（eval/recordings/mitigations）",
  };
}
