/**
 * 読解結果の検証（プログラムが決定的に行う）。
 * 1. zod で形を検証
 * 2. 手法 ID を canonicalTechnique で正規化（廃止 ID は置き換え、存在しない ID は破棄）
 * 3. 根拠文が原文に実在するか文字列照合（空白・全角半角の揺れを吸収）。無ければ quote を消し inferred に落とす。
 *    短すぎる・長すぎる根拠文、stated 以外の段階に付いた根拠文も消す（根拠文があるのは stated だけ、という不変条件）
 * 4. allowedTechniques（型紙にある手法）があれば、それ以外を破棄。推定の段階が型紙外の手法だけでできていれば段階ごと破棄
 *    （「推定段階の補完は型紙の範囲内」）
 * 5. 記事中の指示らしき文を検知して suspiciousInstructions に残す
 *
 * ここで守れないもの：damageType・clarity・段階の有無そのものは Claude の判断で、記事中の指示に従って変えられても
 * 検証では見分けられない。その防御はプロンプト（RULES_JA）と、検知した指示文の画面表示に頼る
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
  /** これより長い根拠文（正規化後の文字数）は捨てる（既定 400。「1〜2 文」の約束を守らせる） */
  maxQuoteLength?: number;
};

/** 表示に使う文字列の上限（Claude の出力が際限なく長くならないように） */
const MAX_TITLE = 200;
const MAX_SUMMARY = 300;

export type VerifyReport = {
  /** 破棄した段階と理由：存在しない戦術 ID、または推定の段階が型紙外の手法だけだった */
  droppedSteps: {
    index: number;
    tactic: string;
    reason: "unknown_tactic" | "inferred_outside_template";
  }[];
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
  /** 消した根拠文と理由：原文に無い、短すぎる、長すぎる、stated 以外の段階に付いていた */
  droppedQuotes: {
    index: number;
    quote: string;
    reason: "not_in_article" | "too_short" | "too_long" | "source_not_stated";
  }[];
  /** stated なのに根拠文が無く inferred に落とした段階 */
  statedWithoutQuote: number[];
  /** 検知した指示らしき文（Claude の報告と、プログラムの検知の和） */
  suspiciousInstructions: string[];
  /** Claude が報告したが原文に無かった指示文（捏造の可能性。破棄） */
  droppedSuspicious: string[];
  /** 画面で注意を出すべき状態（日本語） */
  warnings: string[];
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
  // 出力の項目名や値を名指しして書き換えさせる文（damageType を out_of_scope に、全段階を blocked に、など）
  /(damageType|clarity|source|technique|tactic|steps?|verdict|state|result|quote|suspiciousInstructions|out_of_scope|blocked|inferred|stated|safe)\b[^。\n]{0,40}(にせよ|にしろ|にして|に設定|に変更|に書き換え|とせよ|としろ|として(ください|下さい|出力|回答|判定|記録)|とし(なさい|てください)|にすること|を返|で返)/i,
  /(全|すべての|全ての|各)(段階|ステップ|経路|手法)[^。\n]{0,20}(blocked|止ま|安全|無害|防げ|問題な)/,
  /(この|本|当)(記事|事例|文書|資料|文章)は(安全|無害|攻撃事例ではな|対象外|問題な|脅威ではな)/,
  /ignore\s+(all\s+|the\s+|any\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?)/i,
  /\b(disregard|forget|override)\b[^.\n]{0,40}\b(instructions?|prompts?|rules?)\b/i,
  /\byou\s+are\s+now\b/i,
  /\b(system\s*prompt|developer\s*message)\b/i,
  /\b(output|respond|answer|reply|classify|report)\s+(only\s+)?(with|as|that)\b[^.\n]{0,60}\b(json|safe|blocked|no\s+risk|secure)\b/i,
  /\b(set|mark|classify|treat|label)\b[^.\n]{0,40}\b(as|to)\b[^.\n]{0,20}\b(safe|blocked|out_of_scope|benign|harmless|secure)\b/i,
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

function clip(s: string, max: number): string {
  const t = s.trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
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
  const maxQuote = options.maxQuoteLength ?? 400;
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
    warnings: [],
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
    let outsideTemplate = 0;
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
        outsideTemplate += 1;
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
    // 推定で補った段階が、型紙にない手法だけでできていたなら、型紙の範囲外の補完として段階ごと破棄する
    // （unknown の段階は「入口が不明」のように手法が無くても意味を持つので残す）
    if (s.source === "inferred" && outsideTemplate > 0 && techniques.length === 0) {
      report.droppedSteps.push({ index, tactic, reason: "inferred_outside_template" });
      return;
    }

    let source: CaseStep["source"] = s.source;
    let quote: string | undefined;
    if (s.quote !== null && s.quote.trim() !== "") {
      const q = normalizeText(s.quote);
      if (s.source !== "stated")
        report.droppedQuotes.push({ index, quote: s.quote, reason: "source_not_stated" });
      else if (q.length < minQuote)
        report.droppedQuotes.push({ index, quote: s.quote, reason: "too_short" });
      else if (q.length > maxQuote)
        report.droppedQuotes.push({ index, quote: clip(s.quote, 200), reason: "too_long" });
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
    if (s.summaryJa.trim()) step.summaryJa = clip(s.summaryJa, MAX_SUMMARY);
    steps.push(step);
  });

  const detected = detectInstructions(articleText);
  const reported: string[] = [];
  for (const line of parsed.suspiciousInstructions) {
    const n = normalizeText(line);
    if (n.length >= 4 && normalizedArticle.includes(n)) reported.push(clip(line, 200));
    else report.droppedSuspicious.push(line);
  }
  report.suspiciousInstructions = [...new Set([...reported, ...detected])];

  report.counts.stepsOut = steps.length;
  report.counts.techniquesOut = steps.reduce((n, s) => n + s.techniques.length, 0);
  report.counts.quotesOut = steps.filter((s) => s.quote !== undefined).length;

  if (steps.length === 0) report.warnings.push("攻撃の段階を 1 つも読み取れませんでした");
  else if (allowed && report.counts.techniquesIn > 0 && report.counts.techniquesOut === 0)
    report.warnings.push(
      `読み取った手法がすべて被害の型（${parsed.damageType}）の型紙にありません。記事の型と型紙が合っていない可能性があります`,
    );
  if (report.suspiciousInstructions.length > 0)
    report.warnings.push(
      `記事の中に読み手への指示らしき文が ${report.suspiciousInstructions.length} 件あります。読解結果が影響を受けていないか確認してください`,
    );

  const c: Case = Case.parse({
    ...(options.url ? { url: options.url } : {}),
    title: clip(parsed.title, MAX_TITLE),
    damageType: parsed.damageType,
    clarity: parsed.clarity,
    steps,
    suspiciousInstructions: report.suspiciousInstructions,
  });
  return { case: c, report };
}
