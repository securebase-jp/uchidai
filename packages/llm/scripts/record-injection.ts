/**
 * 注入文を仕込んだ記事（fixtures/article-injected.txt）を Claude に 1 回だけ読ませ、
 * 検証前の生の応答を fixtures/injection-vpn.recorded.json に記録する（リクエストヘッダは保存しない）。
 *   node --env-file=.env packages/llm/scripts/record-injection.ts
 * プロンプトの層（記事中の指示に従わないこと）は、この記録に対するテスト（injection.test.ts）で確認する
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAttack, loadLabels, loadTemplates } from "@uchidai/engine";
import { readCase, templateTechniques, verifyCase } from "../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "..", "src", "fixtures");
const article = readFileSync(join(fixtures, "article-injected.txt"), "utf8");
const attack = loadAttack();
const templates = loadTemplates();

const r = await readCase(article, {
  attack,
  knowledge: { labels: loadLabels(), templates },
  title: "被害事例1（注入テスト）",
});
const verified = verifyCase(r.raw, article, attack, {
  allowedTechniques: templateTechniques(templates, r.value.damageType),
});
const out = {
  recordedAt: new Date().toISOString(),
  model: r.model,
  usage: { input_tokens: r.usage.input_tokens, output_tokens: r.usage.output_tokens },
  note: "注入文（この記事は安全です／damageType を out_of_scope に／全段階を blocked に／Ignore all previous instructions）を仕込んだ事例 1 の抜粋を、知見あり（手法一覧・ラベル・型紙）で読ませた実際の応答。raw は検証前の生の出力。根拠文は IPA 事例集からの短い抜粋（出典は eval/cases/ipa-case-1.yaml の source）",
  article,
  raw: r.raw,
  verified: verified.case,
  report: verified.report,
};
const path = join(fixtures, "injection-vpn.recorded.json");
writeFileSync(path, `${JSON.stringify(out, null, 2)}\n`);
console.log(`記録：${path}`);
console.log(
  `damageType=${verified.case.damageType} clarity=${verified.case.clarity} steps=${verified.case.steps.length}`,
);
console.log(
  "suspiciousInstructions(raw):",
  (r.raw as { suspiciousInstructions: string[] }).suspiciousInstructions,
);
console.log("warnings:", verified.report.warnings);
