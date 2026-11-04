/**
 * 「何が起きるか」の文の出所の表示と切り替え（操作列。印刷では隠れる）。
 * 既定は Claude の言い換え。切り替えは URL の rewrite=0 に載るので、共有・再読み込みでも同じ設定になる。
 * 切り替えると取り直し、紙面（PDF と印刷）にも反映される
 */
import { InfoButton } from "../components/InfoButton.tsx";
import { withRewrite } from "./params.ts";
import type { TextSourceView } from "./text-source.ts";

export function TextSourceRow({ view }: { view: TextSourceView }) {
  const choose = (rewrite: boolean) => {
    location.hash = withRewrite(location.hash, rewrite);
  };
  return (
    <div className="op-toolbar no-print op-textsrc">
      <span className="small muted">文章：</span>
      <fieldset aria-label="「何が起きるか」の文の書き方" className="op-textsrc-group">
        <button
          type="button"
          className="btn sm"
          aria-pressed={view.effectiveRewrite}
          disabled={!view.canChooseClaude}
          onClick={() => choose(true)}
          title={
            view.canChooseClaude
              ? "Claude が役割名と数値だけから言い換えます"
              : "このサーバには Claude の API キーが設定されていないため、選べません"
          }
        >
          Claude
        </button>
        <button
          type="button"
          className="btn sm"
          aria-pressed={!view.effectiveRewrite}
          onClick={() => choose(false)}
          title="プログラムの固定の文にします"
        >
          テンプレート
        </button>
      </fieldset>
      <span className="small muted" role="status">
        {view.statusJa}
      </span>
      <InfoButton title="「何が起きるか」の文について" align="end">
        <p>
          この文は、既定では Claude が言い換えます。Claude
          に渡すのは役割名と数値だけで、会社名や製品名、ホスト名は渡しません。書かれた数値は検証し、合わないときはテンプレート文に戻します。
        </p>
        <p>
          「テンプレート」を選ぶと、プログラムの固定の文になります。止まる業務、日数、金額、期限は、どちらを選んでも同じ計算結果です。切り替えると紙面（PDF
          と印刷）の文も変わります。
        </p>
        {!view.canChooseClaude && (
          <p>
            このサーバには Claude の API キーが設定されていないため、Claude
            は選べません。キーはサーバ側の環境変数にあり、ブラウザには渡りません。使うときは、サーバを動かす環境に設定してから起動し直してください。
          </p>
        )}
      </InfoButton>
    </div>
  );
}
