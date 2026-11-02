/** `pnpm knowledge:check`：知識ファイルと会社カルテを検証し、JSON Schema を書き出す */
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { checkKnowledge, knowledgeDir, repoRoot, schemaExports } from "../src/knowledge.ts";

const examplesDir = join(repoRoot, "examples");
const profiles = readdirSync(examplesDir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => join(examplesDir, f));

const schemasDir = join(knowledgeDir, "schemas");
mkdirSync(schemasDir, { recursive: true });
for (const [name, schema] of Object.entries(schemaExports)) {
  writeFileSync(join(schemasDir, name), `${JSON.stringify(z.toJSONSchema(schema), null, 2)}\n`);
}

const problems = checkKnowledge(profiles);
if (problems.length > 0) {
  for (const p of problems) console.error(`✗ ${p}`);
  process.exit(1);
}
console.log(
  `✓ 知識ファイルとカルテ ${profiles.length} 件に問題なし。JSON Schema を ${schemasDir} に書き出した`,
);
