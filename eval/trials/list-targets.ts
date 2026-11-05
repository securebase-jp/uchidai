/**
 * 再試験の対象を一覧にする：eval/trials/articles/*.yaml から、id に指定の語を含む記事の id・URL・heldOut を出す。
 * heldOut: true（最後の測定用）は通さないので、--run-list では除く
 *   node --disable-warning=ExperimentalWarning eval/trials/list-targets.ts <語>...
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const dir = join(dirname(fileURLToPath(import.meta.url)), "articles");
const words = process.argv.slice(2);
for (const f of readdirSync(dir).filter((x) => x.endsWith(".yaml"))) {
  const d = parse(readFileSync(join(dir, f), "utf8")) as {
    articles: { id: string; url: string; heldOut?: boolean }[];
  };
  for (const a of d.articles)
    if (words.length === 0 || words.some((w) => a.id.includes(w)))
      console.log([a.id, a.url, a.heldOut ? "HELDOUT" : "ok", f].join("\t"));
}
