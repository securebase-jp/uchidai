/**
 * 製品の選択肢の読み込み。knowledge/kev/products.yaml をそのまま取り込む（サーバと同じ表を使い、画面用に写さない）。
 * 重いので、カルテの製品名の欄が出るときだけ import() で読む（別の塊に分かれる）
 */
import { parse } from "yaml";
import raw from "../../../../../knowledge/kev/products.yaml?raw";
import type { KevProductOption } from "./kevProducts.ts";

type Row = { id: string; labelJa: string; aliases: string[]; versionHintJa?: string };

export const kevProductOptions: KevProductOption[] = (
  (parse(raw) as { products: Row[] }).products ?? []
).map((p) => ({
  id: p.id,
  labelJa: p.labelJa,
  aliases: p.aliases,
  ...(p.versionHintJa ? { versionHintJa: p.versionHintJa } : {}),
}));
