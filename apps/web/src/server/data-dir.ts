/**
 * サーバが書くファイル（確認依頼、所有確認のトークン、KEV のキャッシュ）の置き場。
 * 既定は従来どおり apps/web/.data（git 管理外）。
 * 環境変数 UCHIDAI_DATA_DIR で別の場所に移せる。ポータブル ZIP の起動処理は、フォルダを差し替えても
 * データが消えないよう、利用者のユーザー領域（Windows は %APPDATA%\uchidai など）を渡している
 */
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** 従来の置き場（apps/web/.data） */
export const defaultDataDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".data");

/** UCHIDAI_DATA_DIR が空でなければその絶対パス、無ければ従来の置き場 */
export function dataDirFrom(env: NodeJS.ProcessEnv = process.env): string {
  const value = env.UCHIDAI_DATA_DIR?.trim();
  return value ? resolve(value) : defaultDataDir;
}

export const dataDir = dataDirFrom();
