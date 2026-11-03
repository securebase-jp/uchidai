/**
 * 上部バー：画面の切り替え、会社名（架空なら小さく「架空」）、事例名、明るさの切り替え。
 * ATT&CK の版は常時出さず、情報ボタン（判定に使っている分類）の中に出す
 */
import { useState } from "react";
import type { Route } from "../hooks/useRoute.ts";
import type { CompanyProfile } from "../lib/types.ts";
import { InfoButton } from "./InfoButton.tsx";
import { Logo } from "./Logo.tsx";

type Props = {
  route: Route;
  profile?: CompanyProfile;
  attackVersion?: string;
  theme: "dark" | "light";
  onToggleTheme(): void;
  caseLabel?: string;
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

/** 事例名のチップに出す長さ（これより長ければ省略し、押すと全文を出す） */
const CASE_MAX = 16;

export function TopBar({ route, profile, attackVersion, theme, onToggleTheme, caseLabel }: Props) {
  const [caseOpen, setCaseOpen] = useState(false);
  const caseLong = (caseLabel?.length ?? 0) > CASE_MAX;
  return (
    <header className="topbar">
      <a className="brand" href="#/">
        <Logo />
      </a>
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
      <span className="spacer" />
      <div className="chips">
        {profile && (
          <span className="chip">
            {profile.companyName}
            {profile.fictional && <small className="chip-mark">架空</small>}
          </span>
        )}
        {caseLabel &&
          (caseLong ? (
            <button
              type="button"
              className={`chip chip-btn ${caseOpen ? "open" : ""}`}
              aria-expanded={caseOpen}
              title={caseLabel}
              onClick={() => setCaseOpen((v) => !v)}
            >
              事例：{caseOpen ? caseLabel : `${caseLabel.slice(0, CASE_MAX)}…`}
            </button>
          ) : (
            <span className="chip">事例：{caseLabel}</span>
          ))}
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
        <button
          type="button"
          className="btn sm"
          onClick={onToggleTheme}
          aria-label="黒背景と明るい背景を切り替える"
        >
          {theme === "dark" ? "明るい画面" : "黒い画面"}
        </button>
      </div>
    </header>
  );
}
