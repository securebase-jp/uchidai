/**
 * 実記事の試験（docs/real-article-trials.md）：ウチダイ自身の流れで 1 本の記事を通す。
 *
 *   node --disable-warning=ExperimentalWarning --env-file=<.env のパス> eval/trials/run-trial.ts --id <id> --url <URL>
 *   node --disable-warning=ExperimentalWarning eval/trials/run-trial.ts --id <id> --url <URL> --read-only
 *
 * 流れ：fetchArticle で本文を取って確認用にキャッシュ → POST /api/case/read（URL）→ /api/evaluate と /api/onepager を
 * デモ精工（examples/demo-seiko.json）と、5 問から作ったカルテ（POST /api/profile/from-answers）の両方に当てる。
 * API は listen せず、Hono の app.request() で呼ぶ。
 *
 * 出力（すべて eval/.cache/trials/<id>/、git 管理外）：article.txt（取得した本文）、read.json、<profile>.evaluate.json、
 * <profile>.onepager.json、summary.json（所要時間とトークン）。リクエストヘッダや API キーは保存しない。
 * 本文はリポジトリに入れない（著作権）。
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");

const { values } = parseArgs({
  options: {
    id: { type: "string" },
    url: { type: "string" },
    "read-only": { type: "boolean", default: false },
    /** 5 問の回答（JSON）。省略時は卸売・サービス業、事務所のみ、メールはクラウド、ファイルと基幹は社内、リモートは RDP、バックアップは同じ網 */
    answers: { type: "string" },
    /** 保存済みの read.json（以前の読解の結果）を使い、記事の取得と読解の呼び出しを省く。修正の前後を同じ読解で比べるときに使う */
    "read-from": { type: "string" },
  },
});
if (!values.id || !values.url) {
  console.error("使い方：--id <id> --url <URL> [--read-only] [--answers '<json>']");
  process.exit(2);
}
const id = values.id;
const url = values.url;
const outDir = join(root, "eval", ".cache", "trials", id);
mkdirSync(outDir, { recursive: true });

// Claude API の使用量だけを数える（応答の usage を足す。ヘッダやキーは見ない）
type Usage = {
  calls: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};
const usage: Usage = { calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const origFetch = globalThis.fetch;
globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
  const res = await origFetch(...args);
  const target = args[0];
  const u = typeof target === "string" ? target : target instanceof URL ? target.href : target.url;
  if (u.includes("api.anthropic.com")) {
    try {
      const j = (await res.clone().json()) as {
        usage?: {
          input_tokens?: number;
          output_tokens?: number;
          cache_read_input_tokens?: number;
          cache_creation_input_tokens?: number;
        };
      };
      if (j.usage) {
        usage.calls += 1;
        usage.input += j.usage.input_tokens ?? 0;
        usage.output += j.usage.output_tokens ?? 0;
        usage.cacheRead += j.usage.cache_read_input_tokens ?? 0;
        usage.cacheWrite += j.usage.cache_creation_input_tokens ?? 0;
      }
    } catch {
      // JSON でない応答は数えない
    }
  }
  return res;
}) as typeof fetch;

const { app } = await import("../../apps/web/src/server/app.ts");
const { fetchArticle, resolveFetch } = await import("@uchidai/llm");
const { guardedFetch } = await import("../../apps/web/src/server/safe-url.ts");

function save(name: string, data: unknown): void {
  writeFileSync(join(outDir, name), `${JSON.stringify(data, null, 2)}\n`);
}
async function call(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<{ status: number; ms: number; json: any }> {
  const t0 = performance.now();
  const res = await app.request(`http://localhost${path}`, {
    method,
    ...(body !== undefined
      ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
      : {}),
  });
  const ms = Math.round(performance.now() - t0);
  return { status: res.status, ms, json: await res.json() };
}

const summary: Record<string, unknown> = { id, url, startedAt: new Date().toISOString() };

const readFrom = values["read-from"];
let read: { status: number; ms: number; json: any };
if (readFrom) {
  // 保存済みの読解の結果を使う（記事の取得も読解の呼び出しもしない）
  read = { status: 200, ms: 0, json: JSON.parse(readFileSync(readFrom, "utf8")) };
  summary.readFrom = readFrom;
} else {
  // 1. 本文を取る（確認用）。ウチダイの URL 読みと同じ fetchArticle（本文の抽出）を通す
  const tFetch = performance.now();
  const article = await fetchArticle({ kind: "url", url }, { fetch: guardedFetch(resolveFetch()) });
  summary.fetchMs = Math.round(performance.now() - tFetch);
  writeFileSync(join(outDir, "article.txt"), article.text);
  summary.article = { title: article.title, chars: article.text.length, kind: article.kind };
  // 次の読解の呼び出しが同じ記事をもう一度取るので、同じホストへの間隔を 1 秒以上空ける
  await new Promise((r) => setTimeout(r, 1100));

  // 2. 読解（API 経由）
  read = await call("POST", "/api/case/read", { input: { kind: "url", url } });
  summary.read = { status: read.status, ms: read.ms };
  save("read.json", read.json);
}
if (read.status !== 200) {
  console.error("read failed", read.status, JSON.stringify(read.json).slice(0, 500));
  summary.usage = usage;
  save("summary.json", summary);
  process.exit(1);
}
const theCase = read.json.case;

if (!values["read-only"]) {
  // 3. カルテ 2 種
  const demo = await call("GET", "/api/examples/demo-seiko");
  const answers = values.answers
    ? JSON.parse(values.answers)
    : {
        industry: "wholesale_service",
        site: "office_only",
        hosting: { mail: "cloud", files: "onprem", core: "onprem", web: "provider" },
        remoteAccess: ["rdp"],
        backup: "same_network",
      };
  const mine = await call("POST", "/api/profile/from-answers", {
    answers,
    companyName: "試験用商事（5問から）",
    profileId: "trial-from-answers",
  });
  if (mine.status !== 200) console.error("from-answers failed", mine.status, mine.json);
  const profiles: Record<string, unknown> = {
    "demo-seiko": demo.json.profile,
    "from-answers": mine.json.profile,
  };
  for (const [name, profile] of Object.entries(profiles)) {
    const ev = await call("POST", "/api/evaluate", {
      case: theCase,
      profile,
      measureIds: [],
      answers: [],
    });
    save(`${name}.evaluate.json`, ev.json);
    // 一枚は、デモ精工では Claude の言い換えあり、5 問のカルテではテンプレート文（トークンを抑える）
    const op = await call("POST", "/api/onepager", {
      case: theCase,
      profile,
      measureIds: [],
      answers: [],
      rewrite: name === "demo-seiko",
    });
    save(`${name}.onepager.json`, op.json);
    summary[name] = {
      evaluateStatus: ev.status,
      evaluateMs: ev.ms,
      onepagerStatus: op.status,
      onepagerMs: op.ms,
    };
  }
}

summary.usage = usage;
summary.finishedAt = new Date().toISOString();
save("summary.json", summary);
console.log(JSON.stringify(summary, null, 2));
