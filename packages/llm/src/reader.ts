/**
 * 記事の読解。Claude は「読む」だけで、判定はしない。
 * - readCase：ATT&CK の手法一覧（と、あれば日本語ラベル・型紙）を渡して読む
 * - readCaseWithoutKnowledge：知見ファイルを一切渡さずに読む（比較用）
 * - listGenericMitigations：知見なしの Claude に対策を緩和策 ID つきで列挙させる（比較用）
 */
import type { AttackData } from "@uchidai/engine";
import { callStructured, type LlmOptions, type StructuredResult } from "./client.ts";
import {
  buildMitigationsSystem,
  buildNoKnowledgeSystem,
  buildReadSystem,
  type ReadKnowledge,
  wrapArticle,
} from "./prompts.ts";
import {
  type RawCase,
  RawCase as RawCaseSchema,
  type RawMitigations,
  RawMitigations as RawMitigationsSchema,
  rawCaseJsonSchema,
  rawMitigationsJsonSchema,
} from "./schema.ts";
import { type VerifiedCase, type VerifyOptions, verifyCase } from "./verify.ts";

export type ReadOptions = LlmOptions & {
  attack: AttackData;
  /** 知見ファイル。渡されたときだけ日本語ラベルと型紙を使う */
  knowledge?: ReadKnowledge;
  url?: string;
  title?: string;
};

export type ReadResult = StructuredResult<RawCase>;

/** 記事を読み、検証前の形（RawCase）を返す。検証は verifyCase で行う */
export async function readCase(text: string, options: ReadOptions): Promise<ReadResult> {
  const meta: { title?: string; url?: string } = {};
  if (options.title) meta.title = options.title;
  if (options.url) meta.url = options.url;
  return callStructured(options, {
    system: buildReadSystem(options.attack, options.knowledge),
    user: wrapArticle(text, meta),
    schema: rawCaseJsonSchema,
    parse: (v) => RawCaseSchema.parse(v),
  });
}

/** 知見なし：ラベル・型紙・手法一覧を渡さず、同じスキーマで読む */
export async function readCaseWithoutKnowledge(
  text: string,
  options: LlmOptions & { url?: string; title?: string } = {},
): Promise<ReadResult> {
  const meta: { title?: string; url?: string } = {};
  if (options.title) meta.title = options.title;
  if (options.url) meta.url = options.url;
  return callStructured(options, {
    system: buildNoKnowledgeSystem(),
    user: wrapArticle(text, meta),
    schema: rawCaseJsonSchema,
    parse: (v) => RawCaseSchema.parse(v),
  });
}

/** 読む → 検証 をまとめて行う */
export async function readAndVerify(
  text: string,
  options: ReadOptions & VerifyOptions,
): Promise<VerifiedCase & { raw: unknown; model: string }> {
  const r = await readCase(text, options);
  const verifyOpts: VerifyOptions = {};
  if (options.allowedTechniques) verifyOpts.allowedTechniques = options.allowedTechniques;
  if (options.url) verifyOpts.url = options.url;
  if (options.minQuoteLength !== undefined) verifyOpts.minQuoteLength = options.minQuoteLength;
  const v = verifyCase(r.value, text, options.attack, verifyOpts);
  return { ...v, raw: r.raw, model: r.model };
}

export type GenericMitigation = {
  /** 実在が確認できた緩和策 ID。Claude が付けなかった、または存在しない ID なら undefined */
  mitigationId?: string;
  /** Claude が付けたが ATT&CK に無かった ID */
  rejectedId?: string;
  nameJa: string;
  reasonJa: string;
};

export type GenericMitigationsResult = {
  items: GenericMitigation[];
  raw: unknown;
  model: string;
  counts: { total: number; withValidId: number; rejectedIds: number; withoutId: number };
};

/** 知見なしの Claude に対策を列挙させ、緩和策 ID の実在だけを確認する（効く／効かないの振り分けは engine 側） */
export async function listGenericMitigations(
  text: string,
  options: LlmOptions & { attack: AttackData; url?: string; title?: string },
): Promise<GenericMitigationsResult> {
  const meta: { title?: string; url?: string } = {};
  if (options.title) meta.title = options.title;
  if (options.url) meta.url = options.url;
  const r = await callStructured<RawMitigations>(options, {
    system: buildMitigationsSystem(),
    user: wrapArticle(text, meta),
    schema: rawMitigationsJsonSchema,
    parse: (v) => RawMitigationsSchema.parse(v),
  });
  const known = new Set(options.attack.mitigations.filter((m) => !m.deprecated).map((m) => m.id));
  const items: GenericMitigation[] = r.value.mitigations.map((m) => {
    const item: GenericMitigation = { nameJa: m.nameJa, reasonJa: m.reasonJa };
    if (m.id) {
      const id = m.id.trim().toUpperCase();
      if (known.has(id)) item.mitigationId = id;
      else item.rejectedId = m.id;
    }
    return item;
  });
  return {
    items,
    raw: r.raw,
    model: r.model,
    counts: {
      total: items.length,
      withValidId: items.filter((i) => i.mitigationId).length,
      rejectedIds: items.filter((i) => i.rejectedId).length,
      withoutId: items.filter((i) => !i.mitigationId && !i.rejectedId).length,
    },
  };
}
