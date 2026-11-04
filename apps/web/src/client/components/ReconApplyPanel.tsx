/**
 * 「カルテに反映する」の前に見せる表：何が変わるか（構成要素／項目／いま → 反映後／種類）と、
 * カルテとの矛盾（件数のバッジと行で。可能性として示す）。反映は親が行う
 */
import { CircleCheck, TriangleAlert } from "lucide-react";
import type { AppliedView } from "../lib/reconApi.ts";
import { APPLY_KIND_LABEL, type ApplyKind, applyChanges, applyRows } from "../lib/reconView.ts";
import type { CompanyProfile } from "../lib/types.ts";
import "./flow.css";
import { InfoButton } from "./InfoButton.tsx";

type Props = {
  before: CompanyProfile;
  applied: AppliedView;
  busy: boolean;
  onApply(): void;
};

const KIND_TONE: Record<ApplyKind, string> = {
  overwrite: "amber",
  new: "green",
  same: "gray",
  add: "cyan",
};

export function ReconApplyPanel({ before, applied, busy, onApply }: Props) {
  const d = applyChanges(before, applied);
  const rows = applyRows(d, before);
  const assetLabel = (id: string) => before.assets.find((a) => a.id === id)?.label ?? id;
  const n = applied.contradictions.length;
  return (
    <div className="stack">
      <div className="panel">
        <h2>
          カルテとの矛盾の可能性
          <span className={`apply-badge ${n > 0 ? "amber" : "green"}`}>
            {n > 0 ? (
              <TriangleAlert size={14} aria-hidden="true" />
            ) : (
              <CircleCheck size={14} aria-hidden="true" />
            )}
            {n > 0 ? `${n} 件` : "なし"}
          </span>
          <InfoButton title="矛盾の見方">
            <p>
              いずれも「可能性」です。別の装置の名前である、設定の反映前である、などの場合もあります。担当者が確かめてください。
            </p>
            {n === 0 && <p>登録内容と外から見える情報の食い違いは見つかりませんでした。</p>}
          </InfoButton>
        </h2>
        {n > 0 && (
          <ul className="chk-list">
            {applied.contradictions.map((c) => (
              <li key={`${c.assetId}-${c.messageJa}`} className="chk-item">
                <div className="chk-line">
                  <span className="st-icon tone-amber" role="img" aria-label="要確認">
                    <TriangleAlert size={18} strokeWidth={2.2} aria-hidden="true" />
                  </span>
                  <span className="chk-name">{assetLabel(c.assetId)}</span>
                  <span className="chk-result">
                    {c.messageJa}
                    <span className="chk-sub muted small">
                      外部：{c.external}／登録：{c.registered}
                    </span>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="panel">
        <h2>
          反映すると変わる項目
          <span className="apply-badge gray">{rows.length} 件</span>
          <InfoButton title="反映の中身">
            <p>
              5 問の初期値には「外部から推定」と付きます。担当者が答えた項目は上書きしません。
              資産の属性は、根拠が「外部確認」になります。
            </p>
            <p>
              緩和策の記録は追加です。担当者登録・ベンダー回答の記録は残り、食い違えば判定で矛盾として出ます。
            </p>
            <p>反映はこのブラウザの localStorage に保存されます。サーバには残りません。</p>
          </InfoButton>
        </h2>
        {rows.length === 0 ? (
          <p className="muted small">変わる項目はありません。</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="evidence apply-table">
              <thead>
                <tr>
                  <th>構成要素</th>
                  <th>項目</th>
                  <th>いま → 反映後</th>
                  <th>種類</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key}>
                    <td>{r.componentJa}</td>
                    <td>
                      <code>{r.itemJa}</code>
                    </td>
                    <td>
                      <span className="apply-change">
                        <span className="muted">{r.before ?? "（空欄）"}</span>
                        <span aria-hidden="true">→</span>
                        <b>{r.after}</b>
                        {r.tagJa && <span className="chip">{r.tagJa}</span>}
                        {r.noteJa && <span className="muted small">{r.noteJa}</span>}
                      </span>
                    </td>
                    <td>
                      <span className={`apply-kind ${KIND_TONE[r.kind]}`}>
                        {APPLY_KIND_LABEL[r.kind]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="row" style={{ marginTop: 12 }}>
          <button type="button" className="btn primary" disabled={busy} onClick={onApply}>
            カルテに反映する
          </button>
        </p>
      </div>
    </div>
  );
}
