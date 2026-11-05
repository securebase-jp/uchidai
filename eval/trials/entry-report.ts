/**
 * 入口の種類の再試験の集計：eval/.cache/trials/<id>/ の結果から、読解の入口の種類、デモ精工と 5 問のカルテの結論、
 * 入口に当たった資産の役割と出所、一枚の最初の文を出す。--before <dir> を付けると、前回の結果も並べる
 *   node --disable-warning=ExperimentalWarning eval/trials/entry-report.ts [--before trials-before-f2] <id>...
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const cache = join(dirname(fileURLToPath(import.meta.url)), "..", ".cache");
const args = process.argv.slice(2);
const bi = args.indexOf("--before");
const before = bi >= 0 ? args.splice(bi, 2)[1] : undefined;
const get = (p: string) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null);

function row(dir: string, id: string): string {
  const read = get(join(cache, dir, id, "read.json"));
  const entry = (read?.case?.steps ?? []).find((s: { tactic: string }) => s.tactic === "TA0001");
  const kind = entry ? `${entry.source}/${entry.entryKind ?? "-"}` : "(入口の段階なし)";
  const out = [`${read?.case?.damageType ?? "?"}`, `入口=${kind}`];
  for (const prof of ["demo-seiko", "from-answers"]) {
    const ev = get(join(cache, dir, id, `${prof}.evaluate.json`));
    const v = ev?.verdict;
    const first = (v?.paths ?? []).map(
      (p: { steps: { role: string }[]; source: string }) => `${p.steps[0]?.role}:${p.source}`,
    );
    out.push(`${prof}=${v?.result ?? "?"}[${[...new Set(first)].join(",") || "-"}]`);
  }
  const op = get(join(cache, dir, id, "demo-seiko.onepager.json"));
  out.push(`一枚1行目=${(op?.onePager?.whatHappensJa?.[0] ?? "").slice(0, 70)}`);
  return out.join("\t");
}
for (const id of args) {
  if (before && existsSync(join(cache, before, id))) console.log(`${id}\t前\t${row(before, id)}`);
  console.log(`${id}\t後\t${row("trials", id)}`);
}
