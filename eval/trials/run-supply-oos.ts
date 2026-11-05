/**
 * 取引先経由・対象外の記事の試験（docs/article-trials/supply-oos.md）：eval/trials/articles/supply-oos.yaml の記事を、
 * run-trial.ts と同じ流れ（読解 → デモ精工と 5 問のカルテで判定 → 一枚）で通し、自動で確かめられる点を check.json に残す。
 *
 *   node --disable-warning=ExperimentalWarning --env-file=<.env のパス> eval/trials/run-supply-oos.ts [--id <id>]...
 *
 * - heldOut: true の記事は通さない（最後の測定用）。--id で指名しても拒む。
 * - 同じホストへは 1.2 秒以上の間隔を空ける。読解は URL で呼ぶ（記事の取得は /api/case/read の中の 1 回だけ）。
 * - 出力は eval/.cache/trials/<id>/（git 管理外）。リクエストヘッダや API キーは保存しない。本文はリポジトリに入れない。
 * - 自動の確認：根拠文が本文と一字一句一致するか、一枚と結論に手法 ID・専門語が漏れていないか、
 *   指示文の検知数、対象外の記事への結論（止められる／止められない）の有無。見落としは人が見る（check.json は補助）。
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { parse } from "yaml";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const { values } = parseArgs({ options: { id: { type: "string", multiple: true } } });

type Item = {
  id: string;
  url: string;
  kind: string;
  alsoOk?: string[];
  heldOut: boolean;
};
const list = (
  parse(readFileSync(join(root, "eval/trials/articles/supply-oos.yaml"), "utf8")) as {
    articles: Item[];
  }
).articles;
const targets = list.filter((a) => !a.heldOut && (!values.id?.length || values.id.includes(a.id)));
for (const id of values.id ?? []) {
  const hit = list.find((a) => a.id === id);
  if (!hit) throw new Error(`一覧にない id：${id}`);
  if (hit.heldOut) throw new Error(`${id} は heldOut（最後の測定用）なので通さない`);
}

// Claude API の使用量だけを数える（応答の usage を足す。ヘッダやキーは見ない）
type Usage = {
  calls: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};
let usage: Usage = { calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const origFetch = globalThis.fetch;
globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
  const res = await origFetch(...args);
  const t = args[0];
  const u = typeof t === "string" ? t : t instanceof URL ? t.href : t.url;
  if (u.includes("api.anthropic.com")) {
    try {
      const j = (await res.clone().json()) as { usage?: Record<string, number> };
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

async function call(method: "GET" | "POST", path: string, body?: unknown) {
  const t0 = performance.now();
  const res = await app.request(`http://localhost${path}`, {
    method,
    ...(body !== undefined
      ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
      : {}),
  });
  return {
    status: res.status,
    ms: Math.round(performance.now() - t0),
    json: (await res.json()) as any,
  };
}

const norm = (s: string) => s.replace(/\s+/g, "");
/** 画面や一枚に出る文のうち、手法 ID・戦術 ID・緩和策 ID・ATT&CK の語が混じっているもの */
const ID_RE = /\b(?:T\d{4}(?:\.\d{3})?|TA\d{4}|M\d{4}|S\d{4}|G\d{4})\b|ATT&CK|MITRE/;
function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) for (const x of v) strings(x, out);
  else if (v && typeof v === "object") for (const x of Object.values(v)) strings(x, out);
  return out;
}

const lastByHost = new Map<string, number>();
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
const profiles: Record<string, unknown> = {
  "demo-seiko": demo.json.profile,
  "from-answers": mine.json.profile,
};

const rows: unknown[] = [];
for (const item of targets) {
  const dir = join(root, "eval", ".cache", "trials", item.id);
  mkdirSync(dir, { recursive: true });
  const save = (name: string, data: unknown) =>
    writeFileSync(join(dir, name), `${JSON.stringify(data, null, 2)}\n`);
  const host = new URL(item.url).host;
  const wait = (lastByHost.get(host) ?? 0) + 1200 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  usage = { calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

  const read = await call("POST", "/api/case/read", { input: { kind: "url", url: item.url } });
  lastByHost.set(host, Date.now());
  save("read.json", read.json);
  const row: Record<string, unknown> = {
    id: item.id,
    expected: item.kind,
    alsoOk: item.alsoOk ?? [],
    readStatus: read.status,
    readMs: read.ms,
  };
  if (read.status !== 200) {
    row.error = JSON.stringify(read.json).slice(0, 300);
    rows.push(row);
    console.log(JSON.stringify(row));
    continue;
  }
  const c = read.json.case;
  let articleText = "";
  try {
    articleText = readFileSync(join(dir, "article.txt"), "utf8");
  } catch {
    // fetch-candidates.ts で取得済みのはず
  }
  const nArticle = norm(articleText);
  const quotes: string[] = (c.steps as any[]).map((s) => s.quote).filter((q) => !!q);
  row.actual = c.damageType;
  row.kindMatch = c.damageType === item.kind;
  row.kindAcceptable = row.kindMatch || (item.alsoOk ?? []).includes(c.damageType);
  row.clarity = c.clarity;
  row.steps = (c.steps as any[]).map(
    (s) => `${s.tactic}[${s.source}]${(s.techniques as string[]).join("+")}`,
  );
  row.quotes = {
    total: quotes.length,
    verbatim: quotes.filter((q) => nArticle.includes(norm(q))).length,
  };
  row.suspicious = (c.suspiciousInstructions ?? []).length;
  row.report = {
    droppedSteps: read.json.report.droppedSteps?.length ?? 0,
    droppedTechniques: read.json.report.droppedTechniques?.length ?? 0,
    droppedQuotes: read.json.report.droppedQuotes?.length ?? 0,
    warnings: read.json.report.warnings ?? [],
    tacticMismatches: read.json.report.tacticMismatches?.length ?? 0,
  };

  const tReadUsage = { ...usage };
  const per: Record<string, unknown> = {};
  for (const [name, profile] of Object.entries(profiles)) {
    const ev = await call("POST", "/api/evaluate", {
      case: c,
      profile,
      measureIds: [],
      answers: [],
    });
    save(`${name}.evaluate.json`, ev.json);
    const op = await call("POST", "/api/onepager", {
      case: c,
      profile,
      measureIds: [],
      answers: [],
      rewrite: name === "demo-seiko",
    });
    save(`${name}.onepager.json`, op.json);
    const v = ev.json.verdict ?? {};
    const text = strings(op.json.onePager).join("\n");
    per[name] = {
      evaluateStatus: ev.status,
      result: v.result,
      headline: v.headlineJa,
      paths: (v.paths ?? []).map((p: any) => `${p.id}(${p.source})`),
      coverageGap: v.coverageGapJa ? true : false,
      onepagerStatus: op.status,
      onepagerResult: op.json.onePager?.result,
      whatHappens: op.json.onePager?.whatHappensJa,
      idLeak: strings(op.json.onePager).filter((s) => ID_RE.test(s)).length,
      says止められる: /止められ|止まります|防げ/.test(text),
      says確認が取れていません: /確認が取れて/.test(text),
    };
  }
  row.profiles = per;
  row.usage = { read: tReadUsage, total: { ...usage } };
  save("check.json", row);
  rows.push(row);
  console.log(JSON.stringify(row));
}
writeFileSync(
  join(root, "eval", ".cache", "trials", "supply-oos-rows.json"),
  `${JSON.stringify(rows, null, 2)}\n`,
);
