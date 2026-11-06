/**
 * 企業の公表（IR・お知らせ・適時開示）の試験：ウチダイ自身の流れで 1 件の公表を通す。
 *
 *   node --disable-warning=ExperimentalWarning --env-file=<.env のパス> eval/trials/run-ir.ts --id <ir.yaml の id>
 *
 * run-trial.ts との違いは入力だけ。run-trial.ts は URL を 2 回取る（確認用の取得と、読解の取得）。この試験は
 * 「各公表の URL を 1 回だけ取る」約束なので、fetch-batch.ts で 1 回取って置いた本文
 * （eval/.cache/trials/<id>/article.txt。fetchArticle の出力そのもの）を、/api/case/read に text として渡す。
 * 表題と出典 URL は ir.yaml の値を付ける（PDF の title は「1 / 1」のような頁表示で、表題にならないため）。
 * 以降（カルテ 2 種での判定と、一枚の言い換え）は run-trial.ts と同じ。
 *
 * 出力（すべて eval/.cache/trials/<id>/、git 管理外）：read.json、<profile>.evaluate.json、<profile>.onepager.json、summary.json。
 * リクエストヘッダや API キーは保存しない。本文はリポジトリに入れない（著作権）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { parse } from "yaml";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");

const { values } = parseArgs({
  options: { id: { type: "string" }, file: { type: "string" }, profiles: { type: "string" } },
});
if (!values.id) {
  console.error(
    "使い方：--id <一覧の id> [--file <articles/ 以下の一覧。既定は ir.yaml>] [--profiles demo3]",
  );
  process.exit(2);
}
const id = values.id;
const list = parse(readFileSync(join(here, "articles", values.file ?? "ir.yaml"), "utf8")) as {
  articles: { id: string; url: string; title: string; fetched: boolean }[];
};
const entry = list.articles.find((a) => a.id === id);
if (!entry) {
  console.error(`${values.file ?? "ir.yaml"} に ${id} がありません`);
  process.exit(2);
}
const outDir = join(root, "eval", ".cache", "trials", id);
const articlePath = join(outDir, "article.txt");
if (!existsSync(articlePath)) {
  console.error(`${articlePath} がありません（fetch-batch.ts で取得できなかった公表）`);
  process.exit(3);
}
const text = readFileSync(articlePath, "utf8");
// 一覧の表題から、版の注記（PDF 版など）を除く
const title = entry.title.replace(
  /（(?:PDF 版|HTML 版|7 月 16 日付 PDF|10 月 15 日更新版|10 月 9 日付)）$/,
  "",
);

// Claude API の使用量だけを数える（応答の usage を足す。ヘッダやキーは見ない）
const usage = { calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
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

mkdirSync(outDir, { recursive: true });
const summary: Record<string, unknown> = {
  id,
  url: entry.url,
  input: "text（fetch-batch.ts で 1 回取得した本文）",
  chars: text.length,
  startedAt: new Date().toISOString(),
};

// 1. 読解（API 経由）
const read = await call("POST", "/api/case/read", {
  input: { kind: "text", text, title, sourceUrl: entry.url },
});
summary.read = { status: read.status, ms: read.ms };
save("read.json", read.json);
if (read.status !== 200) {
  console.error(id, "read failed", read.status, JSON.stringify(read.json).slice(0, 300));
  summary.usage = usage;
  save("summary.json", summary);
  process.exit(1);
}
const theCase = read.json.case;

// 2. カルテ。既定は 2 種（run-trial.ts と同じ）。--profiles demo3 は架空企業 3 社（デモ精工・デモ商事・デモ医院）
const profiles: Record<string, unknown> = {};
if (values.profiles === "demo3") {
  for (const name of ["demo-seiko", "demo-bussan", "demo-clinic"]) {
    const r = await call("GET", `/api/examples/${name}`);
    if (r.status !== 200) console.error("examples failed", name, r.status);
    profiles[name] = r.json.profile;
  }
} else {
  const demo = await call("GET", "/api/examples/demo-seiko");
  const answers = {
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
  profiles["demo-seiko"] = demo.json.profile;
  profiles["from-answers"] = mine.json.profile;
}
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

summary.usage = usage;
summary.finishedAt = new Date().toISOString();
save("summary.json", summary);
console.log(`${id} ok read=${read.ms}ms usage=${JSON.stringify(usage)}`);
