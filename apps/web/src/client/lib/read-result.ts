/** 記事の読解の応答から、担当者が選んだ事例の出所（CaseMeta）を作る。記事の入力と、担当者画面の読み直しで共通 */
import type { CaseMeta } from "../hooks/useApp.tsx";
import type { ReadResponse } from "./api.ts";
import { readFlagsOf } from "./read-notices.ts";

export function caseMetaFromRead(r: ReadResponse): CaseMeta {
  const readFlags = readFlagsOf(r.article);
  const fetchFailures = r.series?.failures ?? r.failures ?? [];
  return {
    label: r.case.title,
    sourceJa: r.series
      ? `Claude が ${r.series.parts.length} 件の公表を${r.series.order === "date" ? "日付順に" : "指定した順に"}読解（${r.model}）`
      : `Claude が記事を読解（${r.model}）`,
    ...(r.article.sourceUrl ? { sourceUrl: r.article.sourceUrl } : {}),
    ...(readFlags.length > 0 ? { readFlags } : {}),
    ...(r.series ? { series: r.series } : {}),
    // 取得に失敗した公表（読めた分だけで読んだとき）。担当者画面に一覧で残す
    ...(fetchFailures.length > 0 ? { fetchFailures } : {}),
  };
}
