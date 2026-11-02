/**
 * 実際の報道記事での読解と型紙への対応づけの計測：`pnpm eval:articles`
 *
 * - eval/articles/list.yaml            記事の一覧（URL、媒体、日付、想定する被害の型と入口。本文は入れない）
 * - eval/.cache/articles/<id>.html     取得した HTML（git 管理外。本文抽出の改善を再取得なしで試すため）
 * - eval/.cache/articles/<id>.txt      抽出した本文（git 管理外）
 * - eval/recordings/articles/<id>.json 記録した Claude の応答（ヘッダなし。根拠文は記事からの短い抜粋で出典つき）
 * - eval/results/articles-<日時>.json と eval/RESULTS.md に結果を記録する
 *
 * 1 記事につき：fetchArticle → readCase（知見あり）→ verifyCase → evaluate（examples/demo-seiko.json）と通し、
 * 被害の型の一致、clarity、段階数、破棄した手法と根拠文、型紙に対応づいた段階数、判定、所要時間を表にする。
 *
 * オプション：
 *   --fetch           記事を取得してキャッシュするだけ（Claude は呼ばない）
 *   --re-extract      キャッシュした HTML から本文を抽出し直す（取得しない）。--replay と併用して本文抽出の改善を測る
 *   --replay          記録の raw に現在の verifyCase と evaluate をかけ直して再計測する（Claude は呼ばない）
 *   --id <id>         対象の記事を絞る（複数可）
 *   --force           キャッシュがあっても取得し直す
 *   EVAL_NOTE=...     RESULTS.md のメモ欄
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  type Case,
  type CompanyProfile,
  type DamageType,
  evaluate,
  type Knowledge,
  loadKnowledge,
  loadLabels,
  loadProfile,
  matchCaseSteps,
  repoRoot,
  type VerdictResult,
} from "@uchidai/engine";
import {
  type Article,
  decodeHtml,
  downloadBytes,
  extractHtml,
  fetchArticle,
  type ReadKnowledge,
  readCase,
  templateTechniques,
  verifyCase,
} from "@uchidai/llm";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { DamageType as DamageTypeSchema, TechniqueId } from "./types.ts";

const here = dirname(fileURLToPath(import.meta.url));

/** 結果ファイル名の日時（run.ts と同じ規則。run.ts は読み込むと評価を実行するので import しない） */
function resultStamp(now: Date): string {
  return now.toISOString().replace(/[-:]/g, "").slice(0, 15).replace("T", "-");
}
const root = join(here, "..");
const dirs = {
  list: join(root, "articles", "list.yaml"),
  cache: join(root, ".cache", "articles"),
  recordings: join(root, "recordings", "articles"),
  results: join(root, "results"),
};

// ---------------------------------------------------------------------------
// 一覧と記録の形
// ---------------------------------------------------------------------------
export const ArticleEntry = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  url: z.string().url(),
  media: z.string(),
  date: z.string(),
  title: z.string(),
  expectedDamageType: DamageTypeSchema,
  expectedEntry: z.array(TechniqueId).default([]),
  summaryJa: z.string(),
  pages: z.number().int().positive().default(1),
});
export const ArticleList = z.object({ articles: z.array(ArticleEntry) });
export type ArticleEntry = z.infer<typeof ArticleEntry>;

/** 記録。リクエストヘッダや API キーは保存しない。根拠文は記事からの短い抜粋（出典は source） */
export const ArticleRecording = z.object({
  id: z.string(),
  source: z.object({ url: z.string(), media: z.string(), date: z.string() }),
  model: z.string(),
  recordedAt: z.string(),
  attackVersion: z.string(),
  note: z.string(),
  article: z.object({ title: z.string().optional(), chars: z.number(), truncated: z.boolean() }),
  /** 検証前の生の出力（再計測の入力） */
  raw: z.unknown(),
  usage: z
    .object({
      inputTokens: z.number(),
      outputTokens: z.number(),
      cacheReadInputTokens: z.number().optional(),
      cacheCreationInputTokens: z.number().optional(),
    })
    .optional(),
  elapsedMs: z.number(),
});
export type ArticleRecording = z.infer<typeof ArticleRecording>;

export type ArticleMeasure = {
  id: string;
  media: string;
  expectedDamageType: DamageType;
  damageType: DamageType;
  damageTypeMatch: boolean;
  clarity: Case["clarity"];
  steps: { in: number; out: number; stated: number; inferred: number; unknown: number };
  techniques: { in: number; out: number };
  droppedTechniques: Record<string, string[]>;
  droppedQuotes: Record<string, number>;
  /** 型紙に対応づいた段階（手法まで一致したもの）と、戦術だけで当たった段階 */
  mapped: { withTechnique: string[]; tacticOnly: string[]; stages: number };
  entryTechnique?: string;
  expectedEntry: string[];
  entryMatch: boolean | null;
  verdict: VerdictResult;
  headlineJa: string;
  unmapped: boolean;
  suspiciousInstructions: string[];
  warnings: string[];
  articleChars: number;
  truncated: boolean;
  elapsedMs: number;
  usage?: ArticleRecording["usage"];
};

// ---------------------------------------------------------------------------
// 取得とキャッシュ
// ---------------------------------------------------------------------------
type CacheMeta = { title?: string; truncated: boolean; chars: number; fetchedAt: string };

function cachePaths(id: string) {
  return {
    html: join(dirs.cache, `${id}.html`),
    txt: join(dirs.cache, `${id}.txt`),
    meta: join(dirs.cache, `${id}.meta.json`),
  };
}

function saveExtracted(id: string, article: Article): CacheMeta {
  const p = cachePaths(id);
  const meta: CacheMeta = {
    ...(article.title ? { title: article.title } : {}),
    truncated: article.truncated ?? false,
    chars: article.text.length,
    fetchedAt: new Date().toISOString(),
  };
  writeFileSync(p.txt, article.text);
  writeFileSync(p.meta, `${JSON.stringify(meta, null, 2)}\n`);
  return meta;
}

/** 記事を取得して HTML と本文をキャッシュに置く（HTML 以外は本文だけ） */
export async function fetchToCache(entry: ArticleEntry): Promise<CacheMeta> {
  mkdirSync(dirs.cache, { recursive: true });
  const p = cachePaths(entry.id);
  const { data, contentType, finalUrl } = await downloadBytes(entry.url);
  const isHtml =
    /text\/html|application\/xhtml/i.test(contentType) || !/\.pdf(\?|#|$)/i.test(finalUrl);
  let article: Article;
  if (isHtml) {
    const html = decodeHtml(data, contentType);
    writeFileSync(p.html, html);
    article = await fetchArticle({ kind: "html", html, sourceUrl: entry.url });
  } else {
    article = await fetchArticle({ kind: "pdf", data, sourceUrl: entry.url });
  }
  return saveExtracted(entry.id, article);
}

/** キャッシュした HTML から本文を抽出し直す（本文抽出の改善を再取得なしで測る） */
export async function reExtract(entry: ArticleEntry): Promise<CacheMeta | undefined> {
  const p = cachePaths(entry.id);
  if (!existsSync(p.html)) return undefined;
  const article = extractHtml(readFileSync(p.html, "utf8"), entry.url);
  return saveExtracted(entry.id, article);
}

function loadCached(id: string): { text: string; meta: CacheMeta } | undefined {
  const p = cachePaths(id);
  if (!existsSync(p.txt)) return undefined;
  const meta: CacheMeta = existsSync(p.meta)
    ? JSON.parse(readFileSync(p.meta, "utf8"))
    : { truncated: false, chars: 0, fetchedAt: "" };
  return { text: readFileSync(p.txt, "utf8"), meta };
}

async function ensureCached(entry: ArticleEntry, force: boolean) {
  const cached = force ? undefined : loadCached(entry.id);
  if (cached) return cached;
  console.log(`  記事を取得: ${entry.url}`);
  await fetchToCache(entry);
  const c = loadCached(entry.id);
  if (!c) throw new Error(`キャッシュに書けませんでした: ${entry.id}`);
  return c;
}

// ---------------------------------------------------------------------------
// 計測
// ---------------------------------------------------------------------------
function tally<T extends { reason: string }>(items: T[], pick: (t: T) => string) {
  const out: Record<string, string[]> = {};
  for (const it of items) {
    const list = out[it.reason] ?? [];
    list.push(pick(it));
    out[it.reason] = list;
  }
  return out;
}

/** 検証前の出力（raw）と本文から、現在の verifyCase と evaluate で計測する */
export function measure(
  entry: ArticleEntry,
  raw: unknown,
  text: string,
  meta: { chars: number; truncated: boolean },
  knowledge: Knowledge,
  readKnowledge: ReadKnowledge,
  profile: CompanyProfile,
  timing: { elapsedMs: number; usage?: ArticleRecording["usage"] },
): ArticleMeasure {
  const rawDamage = (raw as { damageType?: unknown })?.damageType;
  const allowed =
    typeof rawDamage === "string" && readKnowledge.templates
      ? templateTechniques(readKnowledge.templates, rawDamage)
      : new Set<string>();
  const verifyOpts: Parameters<typeof verifyCase>[3] = { url: entry.url };
  if (allowed.size > 0) verifyOpts.allowedTechniques = allowed;
  const { case: c, report } = verifyCase(raw, text, knowledge.attack, verifyOpts);
  const verdict = evaluate(c, profile, { knowledge });

  const template = knowledge.templates.find((t) => t.damageType === c.damageType);
  const matched = template ? matchCaseSteps(template, c.steps, knowledge) : new Map();
  const withTechnique: string[] = [];
  const tacticOnly: string[] = [];
  for (const [stageId, m] of matched) {
    if (m.technique !== undefined) withTechnique.push(`${stageId}:${m.technique}`);
    else tacticOnly.push(stageId);
  }
  const entryStage = template?.stages.find((s) => s.entry);
  const entryStep = entryStage ? matched.get(entryStage.id) : undefined;
  const entryTechnique = entryStep?.technique;
  const expectedParents = new Set(entry.expectedEntry.map((t) => t.split(".")[0]));
  const entryMatch =
    entry.expectedEntry.length === 0
      ? null
      : entryTechnique !== undefined &&
        (entry.expectedEntry.includes(entryTechnique) ||
          expectedParents.has(entryTechnique.split(".")[0] ?? ""));

  const measureOut: ArticleMeasure = {
    id: entry.id,
    media: entry.media,
    expectedDamageType: entry.expectedDamageType,
    damageType: c.damageType,
    damageTypeMatch: c.damageType === entry.expectedDamageType,
    clarity: c.clarity,
    steps: {
      in: report.counts.stepsIn,
      out: report.counts.stepsOut,
      stated: c.steps.filter((s) => s.source === "stated").length,
      inferred: c.steps.filter((s) => s.source === "inferred").length,
      unknown: c.steps.filter((s) => s.source === "unknown").length,
    },
    techniques: { in: report.counts.techniquesIn, out: report.counts.techniquesOut },
    droppedTechniques: tally(report.droppedTechniques, (d) => d.id),
    droppedQuotes: Object.fromEntries(
      Object.entries(tally(report.droppedQuotes, (d) => d.quote)).map(([k, v]) => [k, v.length]),
    ),
    mapped: { withTechnique, tacticOnly, stages: template?.stages.length ?? 0 },
    ...(entryTechnique ? { entryTechnique } : {}),
    expectedEntry: entry.expectedEntry,
    entryMatch,
    verdict: verdict.result,
    headlineJa: verdict.headlineJa,
    unmapped: verdict.result === "out_of_scope" && verdict.headlineJa.includes("対応づけられない"),
    suspiciousInstructions: report.suspiciousInstructions,
    warnings: report.warnings,
    articleChars: meta.chars,
    truncated: meta.truncated,
    elapsedMs: timing.elapsedMs,
    ...(timing.usage ? { usage: timing.usage } : {}),
  };
  return measureOut;
}

// ---------------------------------------------------------------------------
// 実行
// ---------------------------------------------------------------------------
type Options = {
  fetchOnly: boolean;
  reExtract: boolean;
  replay: boolean;
  force: boolean;
  ids?: string[];
};

function parseOptions(argv: string[]): Options {
  const { values } = parseArgs({
    args: argv,
    options: {
      fetch: { type: "boolean", default: false },
      "re-extract": { type: "boolean", default: false },
      replay: { type: "boolean", default: false },
      force: { type: "boolean", default: false },
      id: { type: "string", multiple: true },
    },
    strict: true,
  });
  const o: Options = {
    fetchOnly: values.fetch,
    reExtract: values["re-extract"],
    replay: values.replay,
    force: values.force,
  };
  if (values.id && values.id.length > 0) o.ids = values.id;
  return o;
}

export function loadList(): ArticleEntry[] {
  return ArticleList.parse(parseYaml(readFileSync(dirs.list, "utf8"))).articles;
}

function loadRecording(id: string): ArticleRecording | undefined {
  const p = join(dirs.recordings, `${id}.json`);
  return existsSync(p) ? ArticleRecording.parse(JSON.parse(readFileSync(p, "utf8"))) : undefined;
}

async function record(
  entry: ArticleEntry,
  text: string,
  meta: CacheMeta,
  knowledge: Knowledge,
  readKnowledge: ReadKnowledge,
): Promise<ArticleRecording> {
  const started = Date.now();
  const opts: Parameters<typeof readCase>[1] = {
    attack: knowledge.attack,
    knowledge: readKnowledge,
    url: entry.url,
  };
  if (meta.title) opts.title = meta.title;
  const read = await readCase(text, opts);
  const elapsedMs = Date.now() - started;
  const rec: ArticleRecording = {
    id: entry.id,
    source: { url: entry.url, media: entry.media, date: entry.date },
    model: read.model,
    recordedAt: new Date().toISOString(),
    attackVersion: knowledge.attack.version,
    note: "実際の報道記事を知見あり（手法一覧・日本語ラベル・型紙）で読解した検証前の出力。根拠文は記事からの短い抜粋（出典は source）。計測は --replay で現在の verifyCase と evaluate をかけ直す",
    article: {
      ...(meta.title ? { title: meta.title } : {}),
      chars: meta.chars,
      truncated: meta.truncated,
    },
    raw: read.raw,
    usage: {
      inputTokens: read.usage.input_tokens,
      outputTokens: read.usage.output_tokens,
      ...(read.usage.cache_read_input_tokens != null
        ? { cacheReadInputTokens: read.usage.cache_read_input_tokens }
        : {}),
      ...(read.usage.cache_creation_input_tokens != null
        ? { cacheCreationInputTokens: read.usage.cache_creation_input_tokens }
        : {}),
    },
    elapsedMs,
  };
  mkdirSync(dirs.recordings, { recursive: true });
  writeFileSync(join(dirs.recordings, `${entry.id}.json`), `${JSON.stringify(rec, null, 2)}\n`);
  return rec;
}

const pad = (s: string, n: number) => s.padEnd(n);

function printTable(rows: ArticleMeasure[]) {
  console.log(
    "記事                | 型（想定→実際）              | 明確さ  | 段階(出/入) | 破棄手法 | 対応づけ | 入口     | 判定         | 秒",
  );
  for (const r of rows) {
    const dropped = Object.values(r.droppedTechniques).reduce((n, v) => n + v.length, 0);
    const type = `${r.expectedDamageType}→${r.damageType}${r.damageTypeMatch ? "" : " ✗"}`;
    const verdict = r.unmapped ? "out_of_scope(未対応)" : r.verdict;
    const entry = r.entryTechnique ?? "-";
    console.log(
      `${pad(r.id, 19)} | ${pad(type, 28)} | ${pad(r.clarity, 7)} | ${pad(`${r.steps.out}/${r.steps.in}`, 11)} | ${pad(`${dropped}`, 8)} | ${pad(`${r.mapped.withTechnique.length}/${r.mapped.stages}`, 8)} | ${pad(entry + (r.entryMatch === false ? " ✗" : ""), 8)} | ${pad(verdict, 12)} | ${(r.elapsedMs / 1000).toFixed(1)}`,
    );
  }
}

function summarize(rows: ArticleMeasure[]) {
  const n = rows.length;
  const typeMatch = rows.filter((r) => r.damageTypeMatch).length;
  const inScope = rows.filter((r) => r.expectedDamageType !== "out_of_scope");
  const judged = inScope.filter((r) => r.verdict !== "out_of_scope").length;
  const unmapped = rows.filter((r) => r.unmapped).length;
  const entryRows = rows.filter((r) => r.entryMatch !== null);
  const entryMatch = entryRows.filter((r) => r.entryMatch).length;
  const quotesDropped = rows.reduce(
    (s, r) => s + Object.values(r.droppedQuotes).reduce((a, b) => a + b, 0),
    0,
  );
  const suspicious = rows.reduce((s, r) => s + r.suspiciousInstructions.length, 0);
  const tokens = rows.reduce(
    (s, r) => ({
      input:
        s.input +
        (r.usage?.inputTokens ?? 0) +
        (r.usage?.cacheReadInputTokens ?? 0) +
        (r.usage?.cacheCreationInputTokens ?? 0),
      output: s.output + (r.usage?.outputTokens ?? 0),
    }),
    { input: 0, output: 0 },
  );
  return {
    articles: n,
    damageTypeMatch: typeMatch,
    judgedInScope: judged,
    inScope: inScope.length,
    unmapped,
    entryMatch,
    entryEvaluated: entryRows.length,
    quotesDropped,
    suspiciousInstructions: suspicious,
    tokens,
  };
}

async function main() {
  const opts = parseOptions(process.argv.slice(2));
  const list = loadList();
  for (const id of opts.ids ?? [])
    if (!list.some((e) => e.id === id)) throw new Error(`一覧にない記事です: ${id}`);
  const targets = opts.ids ? list.filter((e) => opts.ids?.includes(e.id)) : list;

  if (opts.fetchOnly) {
    for (const entry of targets) {
      try {
        const cached = opts.force ? undefined : loadCached(entry.id);
        const meta = cached ? cached.meta : await fetchToCache(entry);
        console.log(
          `[${entry.id}] ${cached ? "キャッシュ済み" : "取得"}: ${meta.chars} 文字${meta.truncated ? "（切り詰め）" : ""} ${meta.title ?? ""}`,
        );
      } catch (e) {
        console.log(`[${entry.id}] 取得失敗: ${e instanceof Error ? e.message : e}`);
      }
    }
    return;
  }

  if (opts.reExtract) {
    for (const entry of targets) {
      const meta = await reExtract(entry);
      console.log(
        meta
          ? `[${entry.id}] 抽出し直し: ${meta.chars} 文字 ${meta.title ?? ""}`
          : `[${entry.id}] HTML のキャッシュがありません`,
      );
    }
    if (!opts.replay) return;
  }

  const knowledge = loadKnowledge();
  const readKnowledge: ReadKnowledge = { labels: loadLabels(), templates: knowledge.templates };
  const profile = loadProfile(join(repoRoot, "examples", "demo-seiko.json"));
  const rows: ArticleMeasure[] = [];
  const failures: { id: string; error: string }[] = [];
  for (const entry of targets) {
    console.log(`\n[${entry.id}] ${entry.title}`);
    try {
      const { text, meta } = await ensureCached(entry, opts.force);
      let rec = opts.replay ? loadRecording(entry.id) : undefined;
      if (opts.replay && !rec) {
        console.log("  記録がありません（--replay）。飛ばします");
        continue;
      }
      if (!rec) rec = await record(entry, text, meta, knowledge, readKnowledge);
      const timing: { elapsedMs: number; usage?: ArticleRecording["usage"] } = {
        elapsedMs: rec.elapsedMs,
      };
      if (rec.usage) timing.usage = rec.usage;
      const m = measure(entry, rec.raw, text, meta, knowledge, readKnowledge, profile, timing);
      rows.push(m);
      console.log(
        `  ${m.damageType}/${m.clarity}、段階 ${m.steps.out}/${m.steps.in}、対応づけ ${m.mapped.withTechnique.length}/${m.mapped.stages}、判定 ${m.verdict}${m.unmapped ? "（型紙に未対応）" : ""}`,
      );
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      console.log(`  失敗: ${error}`);
      failures.push({ id: entry.id, error });
    }
  }

  console.log("");
  printTable(rows);
  const summary = summarize(rows);
  console.log(
    `型の一致 ${summary.damageTypeMatch}/${summary.articles}、判定できた ${summary.judgedInScope}/${summary.inScope}（型紙に未対応 ${summary.unmapped}）、入口の一致 ${summary.entryMatch}/${summary.entryEvaluated}、根拠文の破棄 ${summary.quotesDropped}、指示文の検知 ${summary.suspiciousInstructions}`,
  );
  if (failures.length > 0)
    console.log(`失敗 ${failures.length} 件: ${failures.map((f) => f.id).join(", ")}`);

  const now = new Date();
  const stamp = resultStamp(now);
  mkdirSync(dirs.results, { recursive: true });
  const notes = [opts.replay ? "replay" : "live", process.env.EVAL_NOTE].filter(Boolean);
  writeFileSync(
    join(dirs.results, `articles-${stamp}.json`),
    `${JSON.stringify({ recordedAt: now.toISOString(), options: opts, summary, rows, failures }, null, 2)}\n`,
  );
  const line = `| ${now.toISOString().slice(0, 16).replace("T", " ")} | - | - | ${rows.length} | 実記事：型の一致 ${summary.damageTypeMatch}/${summary.articles}、判定できた ${summary.judgedInScope}/${summary.inScope}（型紙に未対応 ${summary.unmapped}）、入口の一致 ${summary.entryMatch}/${summary.entryEvaluated}、根拠文の破棄 ${summary.quotesDropped}、指示文の検知 ${summary.suspiciousInstructions}${notes.length > 0 ? `、${notes.join("、")}` : ""} |\n`;
  appendFileSync(join(root, "RESULTS.md"), line);
  console.log(`記録しました: eval/results/articles-${stamp}.json, eval/RESULTS.md`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(e instanceof Error ? (e.stack ?? e.message) : e);
    process.exit(1);
  });
}
