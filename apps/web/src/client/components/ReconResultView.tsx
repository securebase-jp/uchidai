/**
 * 外部確認の結果の表示。項目ごとに 1 行のチェック（アイコン・項目名・結果）にし、
 * 説明と根拠のレコードは行を開いたときに出す。推定の項目には「推定」の札、IPA 事例番号には出典番号を付ける。
 * ここでは何も判定しない（表示だけ）。
 */
import { ChevronDown, CircleCheck, Info, type LucideIcon, TriangleAlert, X } from "lucide-react";
import { useState } from "react";
import type { Evidence, ReconResult } from "../lib/reconApi.ts";
import {
  CHECK_STATE_LABEL,
  type CheckRow,
  type CheckState,
  checkRows,
  countStates,
  ctSourceIds,
  ctSourceLabel,
} from "../lib/reconView.ts";
import "./flow.css";
import { InfoButton } from "./InfoButton.tsx";
import { SourceRef } from "./SourceRef.tsx";

const STATE_VIEW: Record<
  CheckState,
  { Icon: LucideIcon; tone: "green" | "amber" | "red" | "gray" }
> = {
  ok: { Icon: CircleCheck, tone: "green" },
  warn: { Icon: TriangleAlert, tone: "amber" },
  bad: { Icon: X, tone: "red" },
  info: { Icon: Info, tone: "gray" },
};

/** チェックの状態のアイコン（形と色と読み上げ名で区別する） */
function CheckIcon({ state, size = 18 }: { state: CheckState; size?: number }) {
  const { Icon, tone } = STATE_VIEW[state];
  return (
    <span className={`st-icon tone-${tone}`} role="img" aria-label={CHECK_STATE_LABEL[state]}>
      <Icon size={size} strokeWidth={2.2} aria-hidden="true" />
    </span>
  );
}

function EvidenceList({ items }: { items: Evidence[] }) {
  if (items.length === 0) return <p className="muted small">根拠のレコードなし</p>;
  return (
    <ul className="small" style={{ margin: "4px 0 0", paddingLeft: 18 }}>
      {items.slice(0, 8).map((e) => (
        <li key={`${e.kind}-${e.recordType}-${e.name}-${e.value}`}>
          <code>{e.kind === "ct" ? "CT" : e.recordType}</code> <code>{e.name}</code>{" "}
          <span className="muted" style={{ wordBreak: "break-all" }}>
            {e.value}
          </span>
        </li>
      ))}
      {items.length > 8 && <li className="muted">ほか {items.length - 8} 件</li>}
    </ul>
  );
}

function HostnameTable({ result }: { result: ReconResult }) {
  if (result.hostnames.length === 0) return null;
  return (
    <div style={{ overflowX: "auto", marginTop: 8 }}>
      <table className="evidence">
        <thead>
          <tr>
            <th>名前</th>
            <th>証明書</th>
            <th>有効期限内</th>
            <th>最後の期限</th>
            <th>DNS</th>
          </tr>
        </thead>
        <tbody>
          {result.hostnames.map((h) => (
            <tr key={h.name}>
              <td>
                <code>{h.name}</code>
              </td>
              <td>{h.certCount}</td>
              <td>{h.activeCertCount}</td>
              <td>{h.lastExpiry?.slice(0, 10) ?? ""}</td>
              <td>
                {h.resolves === null
                  ? "未確認"
                  : h.resolves
                    ? `解決できる（${h.addresses.join(", ")}）`
                    : "名前なし"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 行を開いたときの中身：説明文、根拠のレコード、項目ごとの補足 */
function RowDetail({ row, result }: { row: CheckRow; result: ReconResult }) {
  const f = row.finding;
  const vpn = row.candidates.filter((c) => c.current);
  const past = row.candidates.filter((c) => !c.current);
  return (
    <div className="chk-body">
      <p>
        <b>{f.titleJa}</b>
        {row.inferred && (
          <span className="chip" style={{ marginLeft: 8 }}>
            推定（固定表の当てはめ。断定ではありません）
          </span>
        )}
      </p>
      {f.detailJa && <p className="small">{f.detailJa}</p>}
      {f.ipaCases.length > 0 && f.sourceJa && <p className="muted small">出典：{f.sourceJa}</p>}
      {vpn.map((c) => (
        <p key={c.hostname} className="small">
          <code>{c.hostname}</code>　{c.kind === "vpn" ? "VPN 用" : "遠隔操作用"}と推定（
          {c.reasonJa}）
        </p>
      ))}
      {past.map((c) => (
        <p key={c.hostname} className="small muted">
          <code>{c.hostname}</code>　過去の痕跡（{c.reasonJa}）。初期値や矛盾には使いません
        </p>
      ))}
      <EvidenceList items={f.evidence} />
      {f.id === "hostnames.ct" && (
        <>
          <p className="small" style={{ marginTop: 8 }}>
            証明書の公開ログに載っている名前：{result.hostnames.length} 件（うち DNS
            で解決できる名前 {result.hostnames.filter((h) => h.resolves).length} 件、ワイルドカード{" "}
            {result.hostnames.filter((h) => h.wildcard).length} 件）
          </p>
          <HostnameTable result={result} />
        </>
      )}
    </div>
  );
}

function CheckItem({ row, result, ipaN }: { row: CheckRow; result: ReconResult; ipaN: number }) {
  const [open, setOpen] = useState(false);
  const f = row.finding;
  return (
    <li className={`chk-item state-${row.state}`}>
      <div className="chk-line">
        <CheckIcon state={row.state} />
        <button
          type="button"
          className="chk-toggle"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="chk-name">{row.nameJa}</span>
          {row.resultJa && (
            <span className={`chk-result${row.id.startsWith("remote_access") ? " mono" : ""}`}>
              {row.resultJa}
              {row.inferred && <span className="chk-guess">推定</span>}
            </span>
          )}
        </button>
        {f.ipaCases.length > 0 && (
          <span className="chk-tag">
            IPA 事例 {f.ipaCases.join("・")}
            <SourceRef
              id="ipa-sme-jirei"
              n={ipaN}
              titleJa="IPA 中小企業の情報セキュリティ対策事例集"
            />
          </span>
        )}
        <ChevronDown size={16} className={`chk-chev${open ? " open" : ""}`} aria-hidden="true" />
      </div>
      {open && <RowDetail row={row} result={result} />}
    </li>
  );
}

export function ReconResultView({ result, fixture }: { result: ReconResult; fixture: boolean }) {
  const rows = checkRows(result);
  const counts = countStates(rows);
  const ctIds = ctSourceIds(result.sources);
  const ipaN = ctIds.length + 1;
  const CT_NAME: Record<string, string> = { crtsh: "crt.sh", certspotter: "Cert Spotter" };
  return (
    <div className="stack">
      <div className="row">
        <span className="chip mono">{result.domain}</span>
        <span className="chip">確認日時 {result.checkedAt.replace("T", " ").slice(0, 16)} UTC</span>
        <span className="chip">
          参照：DNS（{result.sources.dns === "fixture" ? "記録" : "公開レコード"}）、証明書ログ（
          {ctSourceLabel(result.sources)}）
          {ctIds.map((id, i) => (
            <SourceRef key={id} id={id} n={i + 1} titleJa={CT_NAME[id] ?? id} />
          ))}
        </span>
        {fixture && <span className="chip fiction">架空のドメインの記録を再生</span>}
      </div>
      <div className="panel">
        <h2>
          チェック結果
          <InfoButton title="この一覧の見方">
            <p>
              1 行が 1 つの確認項目です。行を押すと、説明と根拠にしたレコード（TXT・MX・CNAME
              など）が開きます。「推定」と付いた項目は、名前やレコードの形を固定の表に当てはめた結果で、断定ではありません。
            </p>
            <p>
              参照したのは DNS
              の公開レコードと証明書の公開ログだけです。見つかったホストには接続していません（ポートスキャン、Web
              の取得、TLS 接続を含めて行いません）。
            </p>
          </InfoButton>
          <span className="chk-summary">
            {(["bad", "warn", "ok", "info"] as const)
              .filter((k) => counts[k] > 0)
              .map((k) => (
                <span key={k} className="chk-count">
                  <CheckIcon state={k} size={15} />
                  {CHECK_STATE_LABEL[k]} {counts[k]}
                </span>
              ))}
          </span>
        </h2>
        <ul className="chk-list">
          {rows.map((row) => (
            <CheckItem key={row.id} row={row} result={result} ipaN={ipaN} />
          ))}
        </ul>
        {result.notesJa.length > 0 && (
          <ul className="chk-notes small">
            {result.notesJa.map((n) => (
              <li key={n}>
                <CheckIcon state="info" size={14} />
                {n}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
