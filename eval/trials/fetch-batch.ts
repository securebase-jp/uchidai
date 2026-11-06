/**
 * 実記事の試験の候補を取得して確認する（Claude は呼ばない）。
 *
 *   node --disable-warning=ExperimentalWarning eval/trials/fetch-batch.ts <id>=<URL> [<id>=<URL> ...]
 *
 * fetchArticle（ウチダイの URL 読みと同じ本文の抽出）で取り、eval/.cache/trials/<id>/article.txt に置く（git 管理外）。
 * タイトル・文字数・本文中の日付らしき文字列・冒頭を表示する。ホストごとに 1 秒以上あける。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const { fetchArticle, resolveFetch } = await import("@uchidai/llm");
const { guardedFetch } = await import("../../apps/web/src/server/safe-url.ts");
const f = guardedFetch(resolveFetch());

const lastByHost = new Map<string, number>();
for (const arg of process.argv.slice(2)) {
  const [id, url] = [arg.slice(0, arg.indexOf("=")), arg.slice(arg.indexOf("=") + 1)];
  const host = new URL(url).host;
  const wait = (lastByHost.get(host) ?? 0) + 1200 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  try {
    const a = await fetchArticle({ kind: "url", url }, { fetch: f });
    lastByHost.set(host, Date.now());
    const dir = join(root, "eval", ".cache", "trials", id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "article.txt"), a.text);
    const dates = [...a.text.matchAll(/20\d\d[年/.-]\s?\d{1,2}[月/.-]\s?\d{1,2}日?/g)]
      .map((m) => m[0])
      .slice(0, 4);
    console.log(
      `## ${id} ${url}\n  title: ${a.title}\n  chars: ${a.text.length}  dates: ${dates.join(" | ")}\n  head: ${a.text.replace(/\s+/g, " ").slice(0, 260)}\n`,
    );
  } catch (e) {
    lastByHost.set(host, Date.now());
    console.log(`## ${id} ${url}\n  FAILED: ${(e as Error).message}\n`);
  }
}
