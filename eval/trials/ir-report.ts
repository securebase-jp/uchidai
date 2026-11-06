/**
 * 企業の公表（IR）の試験の結果を、1 件 1 行にまとめる（Claude は呼ばない）。
 *
 *   node --disable-warning=ExperimentalWarning eval/trials/ir-report.ts [--json] [--detail <id>]
 *
 * eval/.cache/trials/<id>/ の read.json・<profile>.evaluate.json・<profile>.onepager.json と、
 * eval/trials/articles/ir.yaml の期待を突き合わせる。出力は標準出力と eval/.cache/ir/summary.json（git 管理外）。
 * 機械的に確かめるのは：種類の一致、根拠文が本文（と表題）に一字一句一致するか（空白を除く）、
 * 段階の確度の分布、指示文の検知、被害を受けた側、判定、一枚の文。
 * 「確認されています」が確度に合っているか、などの意味の判断は、--detail で文を並べて人が読む。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { parse } from "yaml";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const { values } = parseArgs({
  options: { json: { type: "boolean", default: false }, detail: { type: "string" } },
});

type Entry = {
  id: string;
  company: string;
  code: string;
  format: string;
  series?: string;
  kind: string;
  alsoAcceptable?: string[];
  entry: string;
  victim: string;
  fetched: boolean;
  title: string;
};
const list = parse(readFileSync(join(here, "articles", "ir.yaml"), "utf8")) as {
  articles: Entry[];
};

const strip = (s: string) => s.replace(/\s+/g, "");
function readJson(id: string, name: string): any | undefined {
  const p = join(root, "eval", ".cache", "trials", id, name);
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : undefined;
}

type Row = Record<string, unknown>;
const rows: Row[] = [];
for (const e of list.articles) {
  if (!e.fetched) {
    rows.push({ id: e.id, company: e.company, format: e.format, fetched: false });
    continue;
  }
  const art = existsSync(join(root, "eval", ".cache", "trials", e.id, "article.txt"))
    ? readFileSync(join(root, "eval", ".cache", "trials", e.id, "article.txt"), "utf8")
    : "";
  const read = readJson(e.id, "read.json");
  const row: Row = {
    id: e.id,
    company: e.company,
    format: e.format,
    series: e.series,
    fetched: true,
  };
  if (!read || !read.case) {
    row.readError = read?.error ?? "読解の結果なし";
    rows.push(row);
    continue;
  }
  const c = read.case;
  const rep = read.report ?? {};
  const body = strip(art);
  const title = strip(e.title);
  const quotes: string[] = c.steps.map((s: any) => s.quote).filter(Boolean);
  const quotesMatch = quotes.filter((q) => body.includes(strip(q)) || title.includes(strip(q)));
  const certainty: Record<string, number> = {};
  for (const s of c.steps)
    certainty[s.certainty ?? "none"] = (certainty[s.certainty ?? "none"] ?? 0) + 1;
  const entryStep = c.steps.find((s: any) => s.tactic === "TA0001");
  Object.assign(row, {
    expectKind: e.kind,
    kind: c.damageType,
    kindOk: c.damageType === e.kind || (e.alsoAcceptable ?? []).includes(c.damageType),
    kindExact: c.damageType === e.kind,
    clarity: c.clarity,
    steps: c.steps.length,
    certainty,
    entryStep: entryStep
      ? {
          source: entryStep.source,
          certainty: entryStep.certainty,
          entryKind: entryStep.entryKind ?? null,
          techniques: entryStep.techniques,
        }
      : null,
    expectEntry: e.entry,
    victim: c.victim ?? "self(省略)",
    expectVictim: e.victim,
    quotes: quotes.length,
    quotesMatch: quotesMatch.length,
    stated: c.steps.filter((s: any) => s.source === "stated").length,
    suspicious: (c.suspiciousInstructions ?? []).length,
    warnings: (rep.warnings ?? []).length,
    dropped: {
      steps: (rep.droppedSteps ?? []).length,
      techniques: (rep.droppedTechniques ?? []).length,
      quotes: (rep.droppedQuotes ?? []).length,
      statedWithoutQuote: (rep.statedWithoutQuote ?? []).length,
      downgraded: (rep.downgraded ?? []).length,
    },
    leakedData: c.leakedData ?? [],
    reportedLossJpy: c.reportedLossJpy ?? null,
    averted: c.averted ?? false,
    clarityTitle: c.title,
  });
  for (const p of ["demo-seiko", "from-answers"]) {
    const ev = readJson(e.id, `${p}.evaluate.json`);
    const op = readJson(e.id, `${p}.onepager.json`);
    row[p] = {
      result: ev?.verdict?.result ?? ev?.error ?? null,
      template: ev?.verdict?.templateId ?? null,
      headline: ev?.verdict?.headlineJa ?? null,
      stopped: ev?.verdict?.impact?.stopped?.map((s: any) => `${s.name}${s.days}日`) ?? [],
      downtimeDays: ev?.verdict?.impact?.downtimeDays ?? null,
      revenueJpy: ev?.verdict?.impact?.revenueImpactJpy ?? null,
      textSource: op?.text?.source ?? null,
      textNote: op?.text?.noteJa ?? null,
      whatHappensJa: op?.onePager?.whatHappensJa ?? [],
      onepagerError: op?.error ?? null,
    };
  }
  rows.push(row);
}

if (values.detail) {
  const r = rows.find((x) => x.id === values.detail);
  console.log(JSON.stringify(r, null, 2));
  process.exit(0);
}

mkdirSync(join(root, "eval", ".cache", "ir"), { recursive: true });
writeFileSync(
  join(root, "eval", ".cache", "ir", "summary.json"),
  `${JSON.stringify(rows, null, 2)}\n`,
);
if (values.json) {
  console.log(JSON.stringify(rows, null, 2));
  process.exit(0);
}
for (const r of rows) {
  if (!r.fetched) {
    console.log(`${r.id}\t取得できず`);
    continue;
  }
  if (r.readError) {
    console.log(`${r.id}\t読解エラー：${String(r.readError).slice(0, 80)}`);
    continue;
  }
  const d = r["demo-seiko"] as any;
  const f = r["from-answers"] as any;
  console.log(
    [
      r.id,
      `${r.kind}${r.kindOk ? "" : "（期待 " + r.expectKind + "）"}`,
      `明確さ ${r.clarity}`,
      `段階 ${r.steps}（確度 ${JSON.stringify(r.certainty)}）`,
      `入口 ${r.entryStep ? `${(r.entryStep as any).source}/${(r.entryStep as any).certainty}/${(r.entryStep as any).entryKind}` : "なし"}`,
      `被害側 ${r.victim}`,
      `根拠 ${r.quotesMatch}/${r.quotes}`,
      `指示文 ${r.suspicious}`,
      `デモ ${d.result}/${d.template}`,
      `5問 ${f.result}`,
      `一枚 ${d.textSource}`,
    ].join("\t"),
  );
}
