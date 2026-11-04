/** 「何が起きるか」の文の出所の表示（画面の操作列）。判定には関わらない、表示だけの規則 */

export type TextInfo = { source: "claude" | "template"; model?: string; noteJa?: string };

export type TextSourceView = {
  /** 切り替えで押された状態にする側。キーが無いときは、設定が Claude でも実際はテンプレートなのでテンプレート */
  effectiveRewrite: boolean;
  /** Claude を選べるか（サーバに API キーがあるか。不明のうちは選べる） */
  canChooseClaude: boolean;
  /** 一行の状態。出せるものが無いときは空 */
  statusJa: string;
  /** Claude が書いている最中 */
  writing: boolean;
};

export function textSourceView(opts: {
  /** 設定（URL の rewrite。既定は true） */
  rewrite: boolean;
  /** サーバに API キーがあるか（不明なら undefined） */
  available: boolean | undefined;
  /** 一枚を作っている／取り直している最中 */
  busy: boolean;
  /** できた一枚の文の出所（まだ無ければ undefined） */
  text: TextInfo | undefined;
}): TextSourceView {
  const canChooseClaude = opts.available !== false;
  const effectiveRewrite = opts.rewrite && canChooseClaude;
  const writing = opts.busy && effectiveRewrite;
  let statusJa = "";
  if (writing) statusJa = "文を書いています…";
  else if (!opts.busy && opts.text) {
    statusJa =
      opts.text.source === "claude"
        ? `文章：Claude が言い換え（${opts.text.model ?? "モデル名不明"}）`
        : `文章：テンプレート（${opts.text.noteJa ?? (effectiveRewrite ? "プログラムの文" : "切り替えで選択")}）`;
  }
  return { effectiveRewrite, canChooseClaude, statusJa, writing };
}
