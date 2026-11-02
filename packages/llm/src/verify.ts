/**
 * 読解結果の検証（プログラムが決定的に行う）。
 * 1. zod で形を検証
 * 2. 手法 ID を canonicalTechnique で正規化（廃止 ID は置き換え、存在しない ID は破棄）
 * 3. 根拠文が原文に実在するか文字列照合（空白・全角半角の揺れを吸収）。無ければ quote を消し inferred に落とす
 * 4. allowedTechniques（型紙にある手法）があれば、それ以外を破棄
 * 5. 記事中の指示らしき文を検知して suspiciousInstructions に残す
 */
import { type AttackData, Case, type CaseStep, canonicalTechnique } from "@uchidai/engine";
import { RawCase } from "./schema.ts";

/** 空白と全角半角の揺れを吸収して照合する（eval/src/score.ts の normalizeText と同じ規則） */
export function normalizeText(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .replace(/[「」『』“”"'、。．，,.]/g, "");
}

export type VerifyOptions = {
  /** 型紙にある手法。渡されたときはこれ以外の手法を破棄する */
  allowedTechniques?: Iterable<string>;
  url?: string;
  /** これより短い根拠文（正規化後の文字数）は照合しない（既定 8） */
  minQuoteLength?: number;
};

export type VerifyReport = {
  /** 存在しない戦術 ID で破棄した段階 */
  droppedSteps: { index: number; tactic: string; reason: "unknown_tactic" }[];
  /** 廃止 ID を置き換えた手法 */
  replacedTechniques: { index: number; from: string; to: string }[];
  /** 破棄した手法と理由 */
  droppedTechniques: {
    index: number;
    id: string;
    reason: "unknown_id" | "not_in_template" | "duplicate";
  }[];
  /** 手法の戦術が段階の戦術と一致しない（警告。破棄はしない） */
  tacticMismatches: { index: number; id: string; tactic: string }[];
  /** 原文に無かった（または短すぎた）根拠文。quote を消して inferred に落とした */
  droppedQuotes: { index: number; quote: string; reason: "not_in_article" | "too_short" }[];
  /** stated なのに根拠文が無く inferred に落とした段階 */
  statedWithoutQuote: number[];
  /** 検知した指示らしき文（Claude の報告と、プログラムの検知の和） */
  suspiciousInstructions: string[];
  /** Claude が報告したが原文に無かった指示文（捏造の可能性。破棄） */
  droppedSuspicious: string[];
  counts: {
    stepsIn: number;
    stepsOut: number;
    techniquesIn: number;
    techniquesOut: number;
    quotesIn: number;
    quotesOut: number;
  };
};

export type VerifiedCase = { case: Case; report: VerifyReport };

/** 記事中の、読み手（AI）への指示らしき文を検知する。文単位で返す */
const INSTRUCTION_PATTERNS: RegExp[] = [
  /(これまで|以前|上記|前述|直前|全て|すべて)の(指示|命令|プロンプト|ルール|設定)を?(無視|忘れ|破棄|取り消)/,
  /(指示|命令|プロンプト)(を|に|は)(無視|従|忘れ|上書き)/,
  /(AI|ＡＩ|アシスタント|言語モデル|LLM|ChatGPT|Claude|GPT|モデル|システムプロンプト|system prompt|読み手|読者の?AI)(へ|に|は|が|の方|の皆|様|さん)?[、:：]?\s*(あなた|必ず|絶対|次|以下|これ|この|出力|回答|判定|無視|従|と答え)/i,
  /(と|を)(出力|回答|返答|表示|判定|分類|報告|記載)(しなさい|して下さい|してください|せよ|すること|しろ|する必要があります|しなければ)/,
  /(あなたは|お前は|君は)(今から|これから|今後|以後)?[^。\n]{0,20}(です|である|になりました|として振る舞|として動作)/,
  /ignore\s+(all\s+|the\s+|any\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?)/i,
  /\b(disregard|forget|override)\b[^.\n]{0,40}\b(instructions?|prompts?|rules?)\b/i,
  /\byou\s+are\s+now\b/i,
  /\b(system\s*prompt|developer\s*message)\b/i,
  /\b(output|respond|answer|reply|classify|report)\s+(only\s+)?(with|as|that)\b[^.\n]{0,60}\b(json|safe|blocked|no\s+risk|secure)\b/i,
  /\b(assistant|AI|model)\s*[:：]\s*(you\s+must|please|always|never)/i,
];

export function detectInstructions(text: string): string[] {
  const sentences = text
    .split(/(?<=[。．！？!?])|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const hits: string[] = [];
  for (const s of sentences) {
    if (INSTRUCTION_PATTERNS.some((re) => re.test(s)))
      hits.push(s.length > 200 ? `${s.slice(0, 200)}…` : s);
  }
  return [...new Set(hits)];
}

export function verifyCase(
  raw: unknown,
  articleText: string,
  attack: AttackData,
  options: VerifyOptions = {},
): VerifiedCase {
  const parsed = RawCase.parse(raw);
  const normalizedArticle = normalizeText(articleText);
  const minQuote = options.minQuoteLength ?? 8;
  const allowed = options.allowedTechniques ? new Set(options.allowedTechniques) : undefined;
  const tacticIds = new Set(attack.tactics.map((t) => t.id));
  const techniqueTactics = new Map(attack.techniques.map((t) => [t.id, t.tactics]));

  const report: VerifyReport = {
    droppedSteps: [],
    replacedTechniques: [],
    droppedTechniques: [],
    tacticMismatches: [],
    droppedQuotes: [],
    statedWithoutQuote: [],
    suspiciousInstructions: [],
    droppedSuspicious: [],
    counts: {
      stepsIn: parsed.steps.length,
      stepsOut: 0,
      techniquesIn: parsed.steps.reduce((n, s) => n + s.techniques.length, 0),
      techniquesOut: 0,
      quotesIn: parsed.steps.filter((s) => s.quote !== null).length,
      quotesOut: 0,
    },
  };

  const steps: CaseStep[] = [];
  parsed.steps.forEach((s, index) => {
    const tactic = s.tactic.trim().toUpperCase();
    if (!tacticIds.has(tactic)) {
      report.droppedSteps.push({ index, tactic: s.tactic, reason: "unknown_tactic" });
      return;
    }

    const techniques: string[] = [];
    for (const rawId of s.techniques) {
      const id = rawId.trim().toUpperCase();
      const canonical = canonicalTechnique(id, attack);
      if (!canonical) {
        report.droppedTechniques.push({ index, id: rawId, reason: "unknown_id" });
        continue;
      }
      if (canonical !== id) report.replacedTechniques.push({ index, from: id, to: canonical });
      if (allowed && !allowed.has(canonical)) {
        report.droppedTechniques.push({ index, id: canonical, reason: "not_in_template" });
        continue;
      }
      if (techniques.includes(canonical)) {
        report.droppedTechniques.push({ index, id: canonical, reason: "duplicate" });
        continue;
      }
      const tactics = techniqueTactics.get(canonical);
      if (tactics && !tactics.includes(tactic))
        report.tacticMismatches.push({ index, id: canonical, tactic });
      techniques.push(canonical);
    }

    let source: CaseStep["source"] = s.source;
    let quote: string | undefined;
    if (s.quote !== null && s.quote.trim() !== "") {
      const q = normalizeText(s.quote);
      if (q.length < minQuote)
        report.droppedQuotes.push({ index, quote: s.quote, reason: "too_short" });
      else if (!normalizedArticle.includes(q))
        report.droppedQuotes.push({ index, quote: s.quote, reason: "not_in_article" });
      else quote = s.quote;
    }
    if (source === "stated" && quote === undefined) {
      if (s.quote === null || s.quote.trim() === "") report.statedWithoutQuote.push(index);
      source = "inferred";
    }

    const step: CaseStep = { tactic, techniques, source };
    if (quote !== undefined) step.quote = quote;
    if (s.summaryJa.trim()) step.summaryJa = s.summaryJa.trim();
    steps.push(step);
  });

  const detected = detectInstructions(articleText);
  const reported: string[] = [];
  for (const line of parsed.suspiciousInstructions) {
    const n = normalizeText(line);
    if (n.length >= 4 && normalizedArticle.includes(n)) reported.push(line.trim());
    else report.droppedSuspicious.push(line);
  }
  report.suspiciousInstructions = [...new Set([...reported, ...detected])];

  report.counts.stepsOut = steps.length;
  report.counts.techniquesOut = steps.reduce((n, s) => n + s.techniques.length, 0);
  report.counts.quotesOut = steps.filter((s) => s.quote !== undefined).length;

  const c: Case = Case.parse({
    ...(options.url ? { url: options.url } : {}),
    title: parsed.title,
    damageType: parsed.damageType,
    clarity: parsed.clarity,
    steps,
    suspiciousInstructions: report.suspiciousInstructions,
  });
  return { case: c, report };
}
