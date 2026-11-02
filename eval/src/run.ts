/**
 * 評価の実行：`pnpm eval`
 *
 * - eval/cases/*.yaml      正解データ（開発者が確定する）
 * - eval/recordings/*.json 記録した Claude の応答（API キーなしで採点できる）
 * - eval/.cache/<caseId>.txt 記事の原文（任意。あれば根拠文を照合する。リポジトリには入れない）
 * - eval/results/<日時>.json と eval/RESULTS.md に結果を記録する
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
  v === null ? "  -  " : `${Math.round(v * 100)}`.padStart(4) + "%";

function mean(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
}

function main() {
  const cases = loadCases();
  const recordings = loadRecordings();
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
    overallWithKnowledge: byMode("with-knowledge"),
    overallWithoutKnowledge: byMode("without-knowledge"),
    scores,
  };
  console.log(
    `総合：知見あり ${pct(summary.overallWithKnowledge)} / 知見なし ${pct(summary.overallWithoutKnowledge)}`,
  );

  mkdirSync(dirs.results, { recursive: true });
  writeFileSync(join(dirs.results, `${stamp}.json`), `${JSON.stringify(summary, null, 2)}\n`);
  const line = `| ${now.toISOString().slice(0, 16).replace("T", " ")} | ${pct(summary.overallWithKnowledge).trim()} | ${pct(summary.overallWithoutKnowledge).trim()} | ${recordings.length} | ${process.env.EVAL_NOTE ?? ""} |\n`;
  appendFileSync(join(root, "RESULTS.md"), line);
  console.log(`記録しました: eval/results/${stamp}.json, eval/RESULTS.md`);
}

main();
