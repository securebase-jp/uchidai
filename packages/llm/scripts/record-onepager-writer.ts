/**
 * 社長向けの一枚の言い換えを Claude で 1 回実行し、結果を fixtures に記録する（ヘッダは保存しない）。
 *   node --env-file=.env packages/llm/scripts/record-onepager-writer.ts [profileId] [caseId]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildGraph,
  buildOnePager,
  Case,
  CompanyProfile,
  evaluate,
  loadKnowledge,
  repoRoot,
} from "@uchidai/engine";
import { writeOnePagerText, writerInputFrom } from "../src/index.ts";

const profileId = process.argv[2] ?? "demo-seiko";
const caseId = process.argv[3] ?? "ipa-case-1";
const k = loadKnowledge();
const profile = CompanyProfile.parse(
  JSON.parse(readFileSync(join(repoRoot, "examples", `${profileId}.json`), "utf8")),
);
const rec = JSON.parse(
  readFileSync(join(repoRoot, "eval", "recordings", `${caseId}.with-knowledge.json`), "utf8"),
) as { output: unknown };
const theCase = Case.parse(rec.output);
const graph = buildGraph(profile, k.roles);
const verdict = evaluate(theCase, profile, { knowledge: k, graph });
const input = writerInputFrom(verdict, k);
console.log("Claude に渡す入力（役割名と数値だけ）：");
console.log(JSON.stringify(input, null, 1));

const r = await writeOnePagerText(input);
const out = {
  recordedAt: new Date().toISOString(),
  model: r.model,
  usage: { input_tokens: r.usage.input_tokens, output_tokens: r.usage.output_tokens },
  profileId,
  caseId,
  input,
  output: r.raw,
  check: r.rejectedReason ?? "ok",
  templateJa: buildOnePager(verdict, profile, k, { caseTitle: theCase.title }).whatHappensJa,
};
const path = join(
  repoRoot,
  "packages",
  "llm",
  "src",
  "fixtures",
  `onepager-writer.${profileId}.json`,
);
writeFileSync(path, `${JSON.stringify(out, null, 2)}\n`);
console.log(`\n記録：${path}`);
console.log(`検証：${out.check}`);
for (const line of r.value.whatHappensJa) console.log(`  ${line}`);
