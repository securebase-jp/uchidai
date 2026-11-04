/**
 * 一枚の出典番号。紙の上に現れる順に 1 から振る（期限が先、費用が後）。
 * 番号の意味は一枚の末尾「出典と注記」の下に並べる。画面では押すと「データの扱いと出典」の該当項目へ移る
 */
import { STAFF_SOURCES, type StaffSourceId } from "../lib/staff-sources.ts";
import { eventSourceId } from "../lib/timeline-view.ts";
import type { OnePager } from "../lib/types.ts";

export type SourceNumbers = {
  /** 番号の順（紙に現れる順） */
  ids: StaffSourceId[];
  /** 出典の id → 番号（一枚に出てこなければ undefined） */
  n(id: StaffSourceId | undefined): number | undefined;
};

export function sourceNumbers(op: OnePager): SourceNumbers {
  const ids: StaffSourceId[] = [];
  const add = (id: StaffSourceId | undefined) => {
    if (id && !ids.includes(id)) ids.push(id);
  };
  for (const d of [...op.deadlines].sort((a, b) => a.day - b.day)) add(eventSourceId(d));
  if (op.measures.some((m) => m.basis === "ipa")) add("ipa-sme-jirei-cost");
  return { ids, n: (id) => (id ? ids.indexOf(id) + 1 || undefined : undefined) };
}

export const sourceTitle = (id: StaffSourceId): string => STAFF_SOURCES[id].titleJa;
