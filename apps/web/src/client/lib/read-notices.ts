/**
 * 記事を読んだ結果についての、担当者画面の「読解の確認」の文（純粋な関数）。
 * 判定には関わらない。読解の結果をどう受け取ればよいかだけを伝える。
 *  - 攻撃の記事ではないと判断したとき（out_of_scope で段階が 0）：警告ではなく、そのとおりに伝える（TRIAL-S-009）
 *  - 続報で、この文書だけでは種類が分からないとき（needsPrevious）：第一報と合わせて読むよう伝える（TRIAL-I-005）
 *  - 本文が途中で切れていそうなとき：本文を貼れば読めると案内する（TRIAL-B-012）
 */
import type { Case } from "./types.ts";

/** 記事の取得時の印（サーバの article.incomplete / truncated から）。保存して再読み込みしても出す */
export type ReadFlag = "incomplete" | "truncated";

export type ReadNotice = {
  id: "out_of_scope" | "needs_previous" | ReadFlag;
  /** info：そのとおりの報告、warn：確かめてほしいこと */
  tone: "info" | "warn";
  textJa: string;
  /** 本文を貼る入口（はじめに）への案内を付ける */
  pasteLink?: boolean;
};

/** /api/case/read の article から、保存する印を取り出す */
export function readFlagsOf(article: { incomplete?: string[]; truncated?: boolean }): ReadFlag[] {
  const flags: ReadFlag[] = [];
  if (article.incomplete && article.incomplete.length > 0) flags.push("incomplete");
  if (article.truncated) flags.push("truncated");
  return flags;
}

export function readNotices(
  theCase: Pick<Case, "damageType" | "steps" | "needsPrevious">,
  flags: readonly ReadFlag[] = [],
): ReadNotice[] {
  const out: ReadNotice[] = [];
  if (theCase.damageType === "out_of_scope" && theCase.needsPrevious)
    out.push({
      id: "needs_previous",
      tone: "warn",
      textJa: "これは続報で、この文書だけでは種類が分かりません。第一報と合わせて読んでください",
    });
  else if (theCase.damageType === "out_of_scope" && theCase.steps.length === 0)
    out.push({
      id: "out_of_scope",
      tone: "info",
      textJa: "攻撃の記事ではないと判断しました",
    });
  if (flags.includes("incomplete"))
    out.push({
      id: "incomplete",
      tone: "warn",
      textJa: "続きが取得できていない可能性があります。本文を貼って読めます",
      pasteLink: true,
    });
  if (flags.includes("truncated"))
    out.push({
      id: "truncated",
      tone: "info",
      textJa: "記事が長いため、先頭の部分だけを読みました",
    });
  return out;
}
