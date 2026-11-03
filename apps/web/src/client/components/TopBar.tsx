/** 上部バー：画面の切り替え、架空の会社の明記、ATT&CK のバージョン、明るさ */
import type { Route } from "../hooks/useRoute.ts";
import type { CompanyProfile } from "../lib/types.ts";
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

export function TopBar({ route, profile, attackVersion, theme, onToggleTheme, caseLabel }: Props) {
  return (
    <header className="topbar">
      <a className="brand" href="#/">
        <Logo />
        <span className="brand-tag">うちの会社は大丈夫？</span>
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
            {profile.employees ? `（${profile.employees}名）` : ""}
          </span>
        )}
        {profile?.fictional && <span className="chip fiction">架空の会社</span>}
        {caseLabel && (
          <span className="chip" title={caseLabel}>
            事例：{caseLabel.length > 22 ? `${caseLabel.slice(0, 22)}…` : caseLabel}
          </span>
        )}
        {attackVersion && <span className="chip mono">ATT&amp;CK v{attackVersion}</span>}
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
