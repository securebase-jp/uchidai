/**
 * 評価の実行：`pnpm eval`
 *
 * - eval/cases/*.yaml      正解データ（開発者が確定する）
 * - eval/recordings/*.json 記録した Claude の応答（API キーなしで採点できる）
 * - eval/.cache/<caseId>.txt 記事の原文（任意。あれば根拠文を照合する。リポジトリには入れない）
 * - eval/results/<日時>.json と eval/RESULTS.md に結果を記録する
 *
 * オプション：
 *   --live            Claude を呼んで記録を更新してから採点する（ANTHROPIC_API_KEY が必要）
 *   --no-knowledge    without-knowledge の記録だけを採点対象にする
 *   --case <id>       対象の事例を絞る（複数可）
 *   --mode <m>        --live で読むモード（with-knowledge | without-knowledge。既定は両方）
 *   --no-mitigations  --live で知見なしの対策一覧を記録しない
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { parse as parseYaml } from "yaml";
import { type CaseScore, scoreCase } from "./score.ts";
import { type GoldCase, GoldCaseSchema, type Recording, RecordingSchema } from "./types.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const dirs = {
  cases: join(root, "cases"),
  recordings: join(root, "recordings"),
  cache: join(root, ".cache"),
  results: join(root, "results"),
};

function loadCases(): GoldCase[] {
  return readdirSync(dirs.cases)
    .filter((f) => f.endsWith(".yaml"))
    .map((f) => GoldCaseSchema.parse(parseYaml(readFileSync(join(dirs.cases, f), "utf8"))));
}

function loadRecordings(): Recording[] {
  if (!existsSync(dirs.recordings)) return [];
  return readdirSync(dirs.recordings)
    .filter((f) => f.endsWith(".json"))
    .map((f) => RecordingSchema.parse(JSON.parse(readFileSync(join(dirs.recordings, f), "utf8"))));
}

function loadArticle(caseId: string): string | undefined {
  const p = join(dirs.cache, `${caseId}.txt`);
  return existsSync(p) ? readFileSync(p, "utf8") : undefined;
}

const pct = (v: number | null) =>
  v === null ? "  -  " : `${`${Math.round(v * 100)}`.padStart(4)}%`;

function mean(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
}

type Options = {
  live: boolean;
  noKnowledge: boolean;
  caseIds?: string[];
  modes: Recording["mode"][];
  mitigations: boolean;
};

function parseOptions(argv: string[]): Options {
  const { values } = parseArgs({
    args: argv,
    options: {
      live: { type: "boolean", default: false },
      "no-knowledge": { type: "boolean", default: false },
      case: { type: "string", multiple: true },
      mode: { type: "string", multiple: true },
      "no-mitigations": { type: "boolean", default: false },
    },
    strict: true,
  });
  const modes = (values.mode ?? []).map((m) => {
    if (m !== "with-knowledge" && m !== "without-knowledge")
      throw new Error(`--mode は with-knowledge か without-knowledge: ${m}`);
    return m;
  });
  const opts: Options = {
    live: values.live,
    noKnowledge: values["no-knowledge"],
    modes: modes.length > 0 ? modes : ["with-knowledge", "without-knowledge"],
    mitigations: !values["no-mitigations"],
  };
  if (values.case && values.case.length > 0) opts.caseIds = values.case;
  return opts;
}

function score(cases: GoldCase[], opts: Options, note: string) {
  let recordings = loadRecordings();
  if (opts.noKnowledge) recordings = recordings.filter((r) => r.mode === "without-knowledge");
  if (opts.caseIds) recordings = recordings.filter((r) => opts.caseIds?.includes(r.caseId));
  const now = new Date();
  const stamp = now.toISOString().replace(/[-:]/g, "").slice(0, 13).replace("T", "-");

  const scores: CaseScore[] = [];
  for (const rec of recordings) {
    const gold = cases.find((c) => c.id === rec.caseId);
    if (!gold) {
      console.warn(`正解データがありません: ${rec.caseId}`);
      continue;
    }
    const articleText = loadArticle(gold.id);
    scores.push(scoreCase(gold, rec, articleText === undefined ? {} : { articleText }));
  }
  scores.sort((a, b) => a.caseId.localeCompare(b.caseId) || a.mode.localeCompare(b.mode));

  console.log(`正解データ ${cases.length} 件、記録 ${recordings.length} 件`);
  console.log("事例           | 知見 | 段階 | 区別 | 手法 | 根拠 | 判定 | 総合");
  for (const s of scores) {
    const k = s.mode === "with-knowledge" ? "あり" : "なし";
    console.log(
      `${s.caseId.padEnd(14)} | ${k} | ${pct(s.stageRecall)} | ${pct(s.sourceAccuracy)} | ${pct(s.techniqueScore)} | ${pct(s.quoteScore)} | ${pct(s.verdictMatch)} | ${pct(s.overall)}`,
    );
  }

  const byMode = (mode: Recording["mode"]) =>
    mean(scores.filter((s) => s.mode === mode).map((s) => s.overall));
  const summary = {
    recordedAt: now.toISOString(),
    cases: cases.length,
    recordings: recordings.length,
    options: { live: opts.live, noKnowledge: opts.noKnowledge, caseIds: opts.caseIds ?? null },
    overallWithKnowledge: byMode("with-knowledge"),
    overallWithoutKnowledge: byMode("without-knowledge"),
    scores,
  };
  console.log(
    `総合：知見あり ${pct(summary.overallWithKnowledge)} / 知見なし ${pct(summary.overallWithoutKnowledge)}`,
  );

  mkdirSync(dirs.results, { recursive: true });
  writeFileSync(join(dirs.results, `${stamp}.json`), `${JSON.stringify(summary, null, 2)}\n`);
  const line = `| ${now.toISOString().slice(0, 16).replace("T", " ")} | ${pct(summary.overallWithKnowledge).trim()} | ${pct(summary.overallWithoutKnowledge).trim()} | ${recordings.length} | ${note} |\n`;
  appendFileSync(join(root, "RESULTS.md"), line);
  console.log(`記録しました: eval/results/${stamp}.json, eval/RESULTS.md`);
}

async function main() {
  const opts = parseOptions(process.argv.slice(2));
  const cases = loadCases();
  const notes: string[] = [];
  if (opts.live) {
    // 読解の実装（packages/llm）は --live のときだけ読み込む。記録データでの採点に API キーは要らない
    const { runLive } = await import("./live.ts");
    await runLive(cases, { cache: dirs.cache, recordings: dirs.recordings }, opts);
    notes.push("live");
    console.log("");
  }
  if (opts.noKnowledge) notes.push("知見なしのみ");
  if (process.env.EVAL_NOTE) notes.push(process.env.EVAL_NOTE);
  score(cases, opts, notes.join("、"));
}

main().catch((e) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : e);
  process.exit(1);
});
