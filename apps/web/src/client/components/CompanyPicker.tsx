/**
 * 会社と事例の選択。
 * - CompanyChip：上部バーの会社のチップ。押すと「自社のカルテ（保存があるとき）」と架空の会社の一覧
 * - CaseChip：上部バーの事例のチップ。押すと記録済みの事例の一覧と「記事を貼る（はじめにへ）」
 * - CompanyChoiceList / CaseChoiceList：会社・事例が無い画面に出す同じ一覧（ボタンの並び）
 * - MissingChoices：会社と事例のうち、まだ空のものの一覧を会社→事例の順に並べる（担当者画面、社長画面、一枚）
 * 選ぶとその場で読み込み、判定が更新される（useApp.selectCompany / loadRecorded）
 */
import { useEffect, useState } from "react";
import { useApp } from "../hooks/useApp.tsx";
import { api } from "../lib/api.ts";
import {
  type CompanyChoice,
  caseChoices,
  companyChoices,
  isCurrentCompany,
} from "../lib/company-choices.ts";
import { ChipMenu, type ChipMenuItem } from "./ChipMenu.tsx";

function useCompanyItems(): { choices: CompanyChoice[]; items: ChipMenuItem[] } {
  const app = useApp();
  const choices = companyChoices(app.ownProfile, app.examples);
  const current = app.profile
    ? { id: app.profile.id, source: app.profileSource ?? "saved" }
    : undefined;
  const items = choices.map<ChipMenuItem>((c) => ({
    key: c.kind === "own" ? "own" : c.id,
    labelJa: c.kind === "own" ? c.labelJa : c.labelJa.replace(/^架空：/, ""),
    ...(c.kind === "example" && c.fictional ? { mark: "架空" } : {}),
    current: isCurrentCompany(c, current),
    onPick: () =>
      void app.selectCompany(c.kind === "own" ? { kind: "own" } : { kind: "example", id: c.id }),
  }));
  return { choices, items };
}

export function CompanyChip() {
  const app = useApp();
  const { items } = useCompanyItems();
  const p = app.profile;
  return (
    <ChipMenu
      title="会社を選ぶ"
      className={p ? "" : "chip-empty"}
      label={
        p ? (
          <>
            {p.companyName}
            {p.fictional && <small className="chip-mark">架空</small>}
          </>
        ) : (
          "会社を選ぶ"
        )
      }
      items={items}
      emptyJa="架空の会社の一覧を読み込んでいます…"
    />
  );
}

/** 事例名のチップに出す長さ（これより長ければ省略し、吹き出しの中で全文を出す） */
const CASE_MAX = 16;

function useCaseItems(): ChipMenuItem[] {
  const app = useApp();
  const [recorded, setRecorded] = useState<{ caseId: string; title: string; damageType: string }[]>(
    [],
  );
  useEffect(() => {
    api
      .recordedList()
      .then((r) => setRecorded(r.items))
      .catch(() => {});
  }, []);
  const currentId = app.caseMeta?.recorded?.caseId;
  return caseChoices(recorded).map<ChipMenuItem>((c) =>
    c.kind === "recorded"
      ? {
          key: c.id,
          labelJa: c.labelJa,
          current: currentId === c.id,
          onPick: () => void app.loadRecorded(c.id, { chosen: true }),
        }
      : {
          key: "article",
          labelJa: c.labelJa,
          onPick: () => {
            location.hash = "/";
          },
        },
  );
}

export function CaseChip() {
  const app = useApp();
  const items = useCaseItems();
  const label = app.caseMeta?.label;
  return (
    <ChipMenu
      title="事例を選ぶ"
      className={label ? "" : "chip-empty"}
      label={
        label
          ? `事例：${label.length > CASE_MAX ? `${label.slice(0, CASE_MAX)}…` : label}`
          : "事例を選ぶ"
      }
      {...(label && label.length > CASE_MAX ? { note: `いまの事例：${label}` } : {})}
      items={items}
      emptyJa="記録済みの事例を読み込んでいます…"
    />
  );
}

/** 会社が無い画面に出す一覧（上部バーと同じ選択）。文字は最小限 */
export function CompanyChoiceList({ leadJa = "会社を選んでください" }: { leadJa?: string }) {
  const { items } = useCompanyItems();
  return (
    <div className="company-choice">
      <h2>{leadJa}</h2>
      <div className="row" style={{ marginTop: 8 }}>
        {items.map((it) => (
          <button type="button" key={it.key} className="btn sm" onClick={it.onPick}>
            {it.labelJa}
            {it.mark && <small className="chip-mark">{it.mark}</small>}
          </button>
        ))}
        {items.length === 0 && (
          <span className="muted small">架空の会社の一覧を読み込んでいます…</span>
        )}
        <a className="btn sm ghost" href="#/questions">
          最初の5問に答えて自社のカルテを作る
        </a>
      </div>
    </div>
  );
}

/** 事例が無い画面に出す一覧（上部バーと同じ選択）。記録済みの事例は 1 クリックで読み込む */
export function CaseChoiceList({ leadJa = "事例を選んでください" }: { leadJa?: string }) {
  const items = useCaseItems();
  return (
    <div className="company-choice">
      <h2>{leadJa}</h2>
      <div className="row" style={{ marginTop: 8 }}>
        {items.map((it) => (
          <button type="button" key={it.key} className="btn sm" onClick={it.onPick}>
            {it.labelJa}
          </button>
        ))}
        {items.length === 0 && <span className="muted small">事例の一覧を読み込んでいます…</span>}
      </div>
    </div>
  );
}

/** 会社と事例のうち空のものの一覧を、会社→事例の順に 2 段で並べる。どちらも揃っていれば何も出さない */
export function MissingChoices() {
  const { profile, theCase } = useApp();
  if (profile && theCase) return null;
  return (
    <div className="panel" style={{ marginTop: 16 }}>
      {!profile && <CompanyChoiceList />}
      {!theCase && (
        <div style={profile ? undefined : { marginTop: 16 }}>
          <CaseChoiceList />
        </div>
      )}
    </div>
  );
}
