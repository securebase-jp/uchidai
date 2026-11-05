/**
 * 確度（certainty）の再試験の集計：eval/.cache/trials/<id>/ の結果から、確度ごとの段階の数と、
 * 一枚（デモ精工）の文が確度に合っているかを機械的に調べる。記事の本文は読まない
 *   node --disable-warning=ExperimentalWarning eval/trials/certainty-report.ts <id>...
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "eval", ".cache", "trials");
const ids = process.argv.slice(2);
const get = (p: string) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null);
for (const id of ids) {
  const read = get(join(root, id, "read.json"));
  const op = get(join(root, id, "demo-seiko.onepager.json"));
  if (!read?.case) {
    console.log(`${id}\t(読解なし)`);
    continue;
  }
  const steps = read.case.steps as {
    source: string;
    certainty?: string;
    techniques: string[];
    tactic: string;
  }[];
  const certs = steps
    .map((s) => `${s.tactic}:${s.source}${s.certainty ? `/${s.certainty}` : ""}`)
    .join(" ");
  const text: string[] = op?.onePager?.whatHappensJa ?? [];
  const confirmLines = text.filter((l) => /確認(され|が取れ)て(い)?(ま(す|した)|る)/.test(l));
  const estimateConfirm = confirmLines.filter((l) =>
    /\d\s*日|\d[\d,.]*\s*(万|億)?円|止まり|停止/.test(l),
  );
  console.log(
    [
      id,
      `${read.case.damageType}/${read.case.clarity}`,
      certs,
      `downgraded=${JSON.stringify(read.report?.downgraded ?? [])}`,
      `text=${op?.text?.source ?? "-"}`,
      `確認の文=${confirmLines.length}`,
      `試算に確認=${estimateConfirm.length}`,
      op?.text?.noteJa ? `note=${op.text.noteJa.slice(0, 60)}` : "",
    ].join("\t"),
  );
}
