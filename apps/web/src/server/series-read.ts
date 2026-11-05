/**
 * 同じ事故の複数の公表を 1 件として読む（POST /api/case/read の kind: "urls"）。
 * - 連結した本文を 1 件として読む → これが判定に使う事例（根拠文の照合は連結した本文に対して行う）
 * - 各報も別々に読む → 報の間の差分（compareSeries。プログラムが決定的に比べる）の材料にする
 * 判定・差分・期限はプログラム。Claude は読むだけ。
 */
import {
  type AttackData,
  type Case,
  compareSeries,
  type Knowledge,
  loadKnowledge,
  OUT_OF_SCOPE,
  type SeriesReportInput,
  type SeriesView,
} from "@uchidai/engine";
import {
  type ReadKnowledge,
  type ReadOptions,
  readCase,
  templateTechniques,
  verifyCase,
} from "@uchidai/llm";
import type { SeriesInfo } from "../shared/api.ts";
import { isThinReading, thinBodyError } from "./article-source.ts";
import {
  loadSeries,
  quoteSources,
  type SeriesDeps,
  type SeriesFailure,
  type SeriesPart,
} from "./series-source.ts";

export type SeriesReadDeps = SeriesDeps & { readCase?: typeof readCase };

/** 1 件の本文を読み、検証する（単一の記事の経路と同じ手順） */
export async function readVerified(
  text: string,
  meta: { url?: string; title?: string },
  k: Knowledge,
  deps: { readCase?: typeof readCase } = {},
) {
  const knowledge: ReadKnowledge = { labels: k.labels, templates: k.templates };
  const opts: ReadOptions = { attack: k.attack as AttackData, knowledge };
  if (meta.url) opts.url = meta.url;
  if (meta.title) opts.title = meta.title;
  const read = await (deps.readCase ?? readCase)(text, opts);
  const verifyOpts: Parameters<typeof verifyCase>[3] = {};
  if (meta.url) verifyOpts.url = meta.url;
  if (meta.title) verifyOpts.title = meta.title;
  const allowed = templateTechniques(k.templates, read.value.damageType);
  if (allowed.size > 0) verifyOpts.allowedTechniques = allowed;
  const verified = verifyCase(read.raw, text, k.attack, verifyOpts);
  return { read, verified };
}

/** 読めなかった報の代わりに置く、段階の無い事例（比較からは外れる） */
const unreadCase = (title: string): Case => ({
  title,
  damageType: OUT_OF_SCOPE,
  clarity: "unknown",
  steps: [],
  suspiciousInstructions: [],
});

export type SeriesResponse = SeriesInfo;

export async function readSeries(
  urls: string[],
  onError: "fail" | "skip",
  deps: SeriesReadDeps = {},
) {
  const k = loadKnowledge();
  const loaded = await loadSeries(urls, onError, deps);
  const first = loaded.parts[0];
  if (!first) throw new Error("公表が 1 件も読み込まれませんでした");
  const meta: { url?: string; title?: string } = { url: first.url };
  if (first.title) meta.title = first.title;

  const single = loaded.parts.length === 1;
  const [merged, ...each] = await Promise.all([
    readVerified(loaded.text, meta, k, deps),
    ...(single
      ? []
      : loaded.parts.map((p) =>
          readVerified(
            p.text,
            { url: p.url, ...(p.title ? { title: p.title } : {}) },
            k,
            deps,
          ).then(
            (r) => ({ ok: true as const, case: r.verified.case }),
            (e: unknown) => ({
              ok: false as const,
              message: e instanceof Error ? e.message : "読解に失敗しました",
            }),
          ),
        )),
  ]);
  // 保険（TRIAL-I-002）：本文が取れていない（短い）のに「対象外・段階なし」になったときは、判定した顔をしない
  if (isThinReading(merged.verified.case, loaded.text.length))
    throw thinBodyError(loaded.text.replace(/\s+/g, "").length);

  const reports: SeriesReportInput[] = [];
  const readErrors: SeriesResponse["readErrors"] = [];
  loaded.parts.forEach((p, i) => {
    const r = each[i];
    if (r?.ok) reports.push({ label: p.label, ...(p.date ? { date: p.date } : {}), case: r.case });
    else {
      if (r) readErrors.push({ number: p.number, message: r.message });
      reports.push({
        label: p.label,
        ...(p.date ? { date: p.date } : {}),
        case: unreadCase(p.title ?? p.label),
      });
    }
  });
  const series: SeriesResponse = {
    parts: loaded.parts.map(({ text: _text, ...p }) => p),
    order: loaded.order,
    failures: loaded.failures,
    reports,
    readErrors,
    view: compareSeries(reports, k),
    quoteSources: quoteSources(merged.verified.case, loaded.parts),
  };
  return { merged, loaded, series: single ? undefined : series };
}
