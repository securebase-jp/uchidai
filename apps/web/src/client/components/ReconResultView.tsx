/**
 * 外部確認の結果の表示。項目ごとに根拠（レコードの値）と IPA 事例番号を添え、推定のカテゴリには「推定」と書く。
 * ここでは何も判定しない（表示だけ）。
 */
import type { Evidence, ReconResult } from "../lib/reconApi.ts";
import {
  ctSourceLabel,
  groupFindings,
  SEVERITY_LABEL,
  SEVERITY_TONE,
  warningsOf,
} from "../lib/reconView.ts";

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

export function ReconResultView({ result, fixture }: { result: ReconResult; fixture: boolean }) {
  const groups = groupFindings(result);
  const warnings = warningsOf(result);
  const vpn = result.remoteAccessCandidates.filter((c) => c.current);
  const past = result.remoteAccessCandidates.filter((c) => !c.current);
  return (
    <div className="stack">
      <div className="row">
        <span className="chip mono">{result.domain}</span>
        <span className="chip">確認日時 {result.checkedAt.replace("T", " ").slice(0, 16)} UTC</span>
        <span className="chip">
          参照：DNS（{result.sources.dns === "fixture" ? "記録" : "公開レコード"}）、証明書ログ（
          {ctSourceLabel(result.sources)}）
        </span>
        {fixture && <span className="chip fiction">架空のドメインの記録を再生</span>}
      </div>
      {warnings.length > 0 && (
        <div className="panel warn">
          <h2>警告（要確認の項目と注記）</h2>
          <ul className="small" style={{ paddingLeft: 18 }}>
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}
      {groups.map((g) => (
        <div className="panel" key={g.category}>
          <h2>
            {g.labelJa}
            {g.inferred && (
              <span className="chip" style={{ marginLeft: 8 }}>
                推定（固定表の当てはめ。断定ではありません）
              </span>
            )}
          </h2>
          {g.findings.map((f) => (
            <div key={f.id} style={{ marginTop: 8 }}>
              <p>
                <span className={`st ${SEVERITY_TONE[f.severity]}`}>
                  {SEVERITY_LABEL[f.severity]}
                </span>{" "}
                <b>{f.titleJa}</b>
                {f.ipaCases.length > 0 && (
                  <span className="muted small">
                    　IPA 事例集 脆弱性事例 {f.ipaCases.join("・")}
                    {f.sourceJa ? `（${f.sourceJa}）` : ""}
                  </span>
                )}
              </p>
              {f.detailJa && <p className="small">{f.detailJa}</p>}
              <EvidenceList items={f.evidence} />
            </div>
          ))}
          {g.category === "remote_access" && (vpn.length > 0 || past.length > 0) && (
            <div style={{ marginTop: 8 }}>
              {vpn.map((c) => (
                <p key={c.hostname} className="small">
                  <code>{c.hostname}</code>　{c.kind === "vpn" ? "VPN 用" : "遠隔操作用"}
                  と推定（{c.reasonJa}）
                </p>
              ))}
              {past.map((c) => (
                <p key={c.hostname} className="small muted">
                  <code>{c.hostname}</code>　過去の痕跡（{c.reasonJa}）。初期値や矛盾には使いません
                </p>
              ))}
            </div>
          )}
        </div>
      ))}
      <div className="panel">
        <h2>証明書の状況</h2>
        <p className="small">
          証明書の公開ログに載っている名前：{result.hostnames.length} 件（うち DNS で解決できる名前{" "}
          {result.hostnames.filter((h) => h.resolves).length} 件、ワイルドカード{" "}
          {result.hostnames.filter((h) => h.wildcard).length} 件）
        </p>
        {result.hostnames.length > 0 && (
          <div style={{ overflowX: "auto" }}>
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
        )}
      </div>
      <p className="muted small">
        参照したのは DNS
        の公開レコードと証明書の公開ログだけです。見つかったホストには接続していません（ポートスキャン、Web
        の取得、TLS 接続を含めて行いません）。
      </p>
    </div>
  );
}
