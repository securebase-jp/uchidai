/** 担当者画面の出典番号（番号は lib/staff-sources.ts で固定）。押すと「データの扱いと出典」の該当項目へ */
import { STAFF_SOURCES, type StaffSourceId } from "../lib/staff-sources.ts";
import { SourceRef } from "./SourceRef.tsx";

export function StaffSourceRef({ id }: { id: StaffSourceId }) {
  const s = STAFF_SOURCES[id];
  return <SourceRef id={id} n={s.n} titleJa={s.titleJa} />;
}
