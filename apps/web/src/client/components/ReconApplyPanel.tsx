/**
 * 「カルテに反映する」の前に見せる一覧：何が変わるか（外部から推定と付く項目、上書きされる属性、追加される緩和策）と、
 * カルテとの矛盾（可能性として示す）。反映は親が行う
 */
import type { AppliedView } from "../lib/reconApi.ts";
import { applyChanges } from "../lib/reconView.ts";
import type { CompanyProfile } from "../lib/types.ts";

type Props = {
  before: CompanyProfile;
  applied: AppliedView;
  busy: boolean;
  onApply(): void;
};

export function ReconApplyPanel({ before, applied, busy, onApply }: Props) {
  const d = applyChanges(before, applied);
  const assetLabel = (id: string) => before.assets.find((a) => a.id === id)?.label ?? id;
  const nothing =
    d.attrs.length === 0 && d.controls.length === 0 && d.answers.length === 0 && !d.domainChange;
  return (
    <div className="stack">
      <div className="panel">
        <h2>カルテとの矛盾の可能性（{applied.contradictions.length} 件）</h2>
        {applied.contradictions.length === 0 ? (
          <p className="muted small">
            登録内容と外から見える情報の食い違いは見つかりませんでした。
          </p>
        ) : (
          applied.contradictions.map((c) => (
            <p key={`${c.assetId}-${c.messageJa}`} className="small">
              <b>{assetLabel(c.assetId)}</b>：{c.messageJa}
              <br />
              <span className="muted">
                外部：{c.external}／登録：{c.registered}
              </span>
            </p>
          ))
        )}
        <p className="muted small" style={{ marginTop: 6 }}>
          いずれも「可能性」です。別の装置の名前である、設定の反映前である、などの場合もあります。担当者が確かめてください。
        </p>
      </div>
      <div className="panel">
        <h2>反映すると変わる項目</h2>
        {nothing && <p className="muted small">変わる項目はありません。</p>}
        {d.answers.length > 0 && (
          <>
            <p className="small">
              <b>5 問の初期値</b>（「外部から推定」と付きます。担当者が答えた項目は上書きしません）
            </p>
            <ul className="small" style={{ paddingLeft: 18 }}>
              {d.answers.map((a) => (
                <li key={a.key}>
                  {a.labelJa} → {a.after}　<span className="chip">外部から推定</span>
                </li>
              ))}
            </ul>
          </>
        )}
        {d.attrs.length > 0 && (
          <>
            <p className="small" style={{ marginTop: 8 }}>
              <b>資産の属性</b>（根拠は「外部確認」になります）
            </p>
            <ul className="small" style={{ paddingLeft: 18 }}>
              {d.attrs.map((a) => (
                <li key={`${a.assetId}-${a.key}`}>
                  {a.assetLabel}　<code>{a.key}</code>：
                  {a.before === undefined ? (
                    <>
                      {a.after} <span className="muted">（新しく付く）</span>
                    </>
                  ) : a.overwrite ? (
                    <>
                      {a.before} → {a.after} <span className="fx-amber">（上書き）</span>
                    </>
                  ) : (
                    <>
                      {a.after} <span className="muted">（同じ値。根拠だけ外部確認に）</span>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
        {d.controls.length > 0 && (
          <>
            <p className="small" style={{ marginTop: 8 }}>
              <b>緩和策の記録</b>
              （担当者登録・ベンダー回答の記録は残ります。食い違えば判定で矛盾として出ます）
            </p>
            <ul className="small" style={{ paddingLeft: 18 }}>
              {d.controls.map((c) => (
                <li key={`${c.assetId}-${c.mitigation}`}>
                  {c.assetLabel}　<code>{c.mitigation}</code>：
                  {c.status === "present" ? "あり" : c.status === "absent" ? "なし" : "未確認"}
                  {c.noteJa && <span className="muted">　{c.noteJa}</span>}
                </li>
              ))}
            </ul>
          </>
        )}
        {d.domainChange && (
          <p className="small" style={{ marginTop: 8 }}>
            <b>ドメイン</b>：{d.domainChange.before ? `${d.domainChange.before} → ` : ""}
            {d.domainChange.after}（所有確認済み）
          </p>
        )}
        <p className="row" style={{ marginTop: 12 }}>
          <button type="button" className="btn primary" disabled={busy} onClick={onApply}>
            カルテに反映する
          </button>
          <span className="muted small">
            反映はこのブラウザの localStorage に保存されます。サーバには残りません。
          </span>
        </p>
      </div>
    </div>
  );
}
