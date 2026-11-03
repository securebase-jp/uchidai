/**
 * 上部バー：ロゴとその下の一行（名前の由来と用途）、画面の切り替え、会社と事例のチップ（押すと選べる）、明るさの切り替え。
 * チップは呼ぶ側（App の Shell）が渡す。共有リンクの一枚や回答ページでは渡さない（カルテも事例も読まない画面）。
 * ATT&CK の版は常時出さず、情報ボタン（判定に使っている分類）の中に出す
 */
import type { ReactNode } from "react";
import type { Route } from "../hooks/useRoute.ts";
import { InfoButton } from "./InfoButton.tsx";
import { Logo } from "./Logo.tsx";

type Props = {
  route: Route;
  attackVersion?: string;
  theme: "dark" | "light";
  onToggleTheme(): void;
  /** 会社と事例のチップ（CompanyChip と CaseChip） */
  chips?: ReactNode;
};

const NAV: [Route, string][] = [
  ["home", "はじめに"],
  ["domain", "外部確認"],
  ["questions", "最初の5問"],
  ["profile", "カルテ"],
  ["staff", "担当者画面"],
  ["exec", "社長画面"],
  ["onepager", "社長向けの一枚"],
];

export function TopBar({ route, attackVersion, theme, onToggleTheme, chips }: Props) {
  return (
    <header className="topbar">
      <div className="brand-block">
        <a className="brand" href="#/">
          <Logo />
        </a>
        <p className="tagline">
          <span className="tagline-origin">ウチダイ ＝ うちの会社は大丈夫か？</span>
          <span className="tagline-sep" aria-hidden="true">
            ｜
          </span>
          サイバー攻撃対策の簡易評価ツール
        </p>
      </div>
      <nav aria-label="画面">
        {NAV.map(([r, label]) => (
          <a
            key={r}
            href={r === "home" ? "#/" : `#/${r}`}
            aria-current={route === r ? "page" : undefined}
          >
            {label}
          </a>
        ))}
      </nav>
      <button
        type="button"
        className="btn sm theme-toggle"
        onClick={onToggleTheme}
        aria-label="暗い背景と明るい背景を切り替える"
      >
        {theme === "dark" ? "明るい画面" : "暗い画面"}
      </button>
      <div className="chips topbar-chips">
        {chips}
        <InfoButton title="判定に使っている分類" align="end">
          <p>
            攻撃の手法と対策の分類には MITRE ATT&amp;CK Enterprise
            {attackVersion ? ` v${attackVersion}` : ""} を使っています。記事から読み取った段階は
            ATT&amp;CK の手法 ID に対応づけ、対策はその手法に効くとされる緩和策（M で始まる
            ID）で表します。
          </p>
          <p>
            判定そのものはプログラムが行い、Claude は記事を読む・言い換えることだけを担当します。
          </p>
        </InfoButton>
      </div>
    </header>
  );
}
