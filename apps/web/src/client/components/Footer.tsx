/**
 * 画面の下端の小さなリンク「出典」（#/sources）。
 * 共有リンクの一枚・回答ページ・出典の画面そのものには置かない（App.tsx の Shell の中だけ）。
 * デモモードでは出さない（動画に映り込ませない）。発表モード（全画面）でも隠す
 */
import { isDemoMode } from "../demo/params.ts";

export function Footer() {
  if (isDemoMode()) return null;
  return (
    <footer className="site-foot">
      <a className="site-foot-link" href="#/sources">
        出典
      </a>
    </footer>
  );
}
