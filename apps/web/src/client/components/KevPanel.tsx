/**
 * 悪用確認済み脆弱性（CISA KEV）との突き合わせ：カルテ画面の製品名・版の横に出すブロック。
 * - カタログの状態（版、件数、取得日時）。未取得なら「取り込む」、古ければ「更新する」
 * - 「悪用確認済み脆弱性と突き合わせる」→ 該当 CVE、ランサムウェアでの悪用、CISA の対応期限、版の範囲と出典
 * - 該当なら「VPN 装置の更新」が効くこと、認証回避型なら多要素認証が効かないことを一言
 * 判定はサーバ（engine）が行い、結果はカルテの属性（根拠：公開情報）として保存される
 */
import { useEffect, useState } from "react";
import { ApiError } from "../lib/api.ts";
import {
  KEV_STATUS_LABEL,
  KEV_STATUS_TONE,
  type KevMatch,
  type KevMatchView,
  type KevStatusView,
  kevApi,
} from "../lib/kevApi.ts";
import { kevHints } from "../lib/kevHints.ts";
import type { CompanyProfile, Contradiction } from "../lib/types.ts";

type Props = {
  profile: CompanyProfile;
  assetId: string;
  /** 入力欄の現在の値（まだカルテに保存されていない分も含む） */
  product: string;
  version: string;
  roleLabel: string;
  /** 反映後のカルテ（保存は呼び出し側） */
  onApplied(profile: CompanyProfile, match: KevMatch, contradictions: Contradiction[]): void;
};

function fmtDateTime(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString("ja-JP", {
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}

export function KevPanel(p: Props) {
  const [status, setStatus] = useState<KevStatusView>();
  const [statusError, setStatusError] = useState<string>();
  const [busy, setBusy] = useState<"refresh" | "match">();
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<KevMatchView>();

  useEffect(() => {
    let alive = true;
    kevApi
      .status()
      .then((s) => alive && setStatus(s))
      .catch((e) => alive && setStatusError(e instanceof Error ? e.message : "通信に失敗しました"));
    return () => {
      alive = false;
    };
  }, []);

  const refresh = async (force: boolean) => {
    setBusy("refresh");
    setError(undefined);
    setNotice(undefined);
    try {
      const r = await kevApi.refresh(force);
      setStatus(r.status);
      if (!r.ok) setError(r.errorJa ?? "取得できませんでした");
      else
        setNotice(
          r.fetched
            ? `CISA から取り込みました（カタログ版 ${r.status.catalogVersion ?? ""}、${r.status.count?.toLocaleString("ja-JP") ?? ""} 件）`
            : "手元のカタログは 24 時間以内に取得したものなので、取り直していません",
        );
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : "通信に失敗しました");
    } finally {
      setBusy(undefined);
    }
  };

  const match = async () => {
    setBusy("match");
    setError(undefined);
    setNotice(undefined);
    try {
      const r = await kevApi.match(p.profile, p.assetId, p.product, p.version);
      setResult(r);
      setStatus(r.status);
      kevHints.record(
        p.profile.id,
        p.assetId,
        r.match.catalogVersion,
        new Date().toISOString(),
        r.applied.contradictions,
      );
      p.onApplied(r.applied.profile, r.match, r.applied.contradictions);
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : "通信に失敗しました");
    } finally {
      setBusy(undefined);
    }
  };

  const canMatch = Boolean(status?.available) && p.product.trim() !== "" && busy === undefined;
  const asset = p.profile.assets.find((a) => a.id === p.assetId);
  const saved =
    asset?.attrEvidence.knownExploited === "external" && asset.attrs.kevCatalogVersion !== undefined
      ? {
          knownExploited: asset.attrs.knownExploited === true,
          cves: String(asset.attrs.kevCves ?? ""),
          catalogVersion: String(asset.attrs.kevCatalogVersion),
          checkedAt: String(asset.attrs.kevCheckedAt ?? ""),
        }
      : undefined;

  return (
    <section className="kev" aria-label="悪用確認済み脆弱性との突き合わせ">
      <div className="kev-head">
        <b>悪用確認済み脆弱性（CISA KEV）</b>
        {statusError ? (
          <span className="err small">{statusError}</span>
        ) : !status ? (
          <span className="muted small">カタログの状態を読み込んでいます…</span>
        ) : status.available ? (
          <span className="muted small">
            カタログ版 {status.catalogVersion}（公開 {status.dateReleased?.slice(0, 10)}、
            {status.count?.toLocaleString("ja-JP")} 件、取得 {fmtDateTime(status.fetchedAt)}）
            {status.stale && <span className="stale">　24 時間以上前の取得</span>}
          </span>
        ) : (
          <span className="muted small">
            カタログは未取得です（CISA の公開 JSON を 1 回取り込みます）
          </span>
        )}
        <span className="kev-actions">
          {status && !status.available && (
            <button
              type="button"
              className="btn sm primary"
              disabled={busy !== undefined}
              onClick={() => void refresh(false)}
            >
              {busy === "refresh" ? "取り込んでいます…" : "取り込む"}
            </button>
          )}
          {status?.available && (
            <button
              type="button"
              className="btn sm ghost"
              disabled={busy !== undefined}
              onClick={() => void refresh(true)}
              title="CISA から取り直す（24 時間以内なら不要）"
            >
              {busy === "refresh" ? "更新しています…" : "更新する"}
            </button>
          )}
          <button
            type="button"
            className="btn sm"
            disabled={!canMatch}
            onClick={() => void match()}
            title={
              !status?.available
                ? "先にカタログを取り込んでください"
                : p.product.trim() === ""
                  ? "製品名を入力してください"
                  : undefined
            }
          >
            {busy === "match" ? "突き合わせています…" : "悪用確認済み脆弱性と突き合わせる"}
          </button>
        </span>
      </div>
      {status?.lastErrorJa && !error && <p className="muted small">{status.lastErrorJa}</p>}
      {notice && <p className="small kev-notice">{notice}</p>}
      {error && <p className="err small">{error}</p>}
      {!result && saved && (
        <p className="muted small">
          前回の突き合わせ（カタログ版 {saved.catalogVersion}、{fmtDateTime(saved.checkedAt)}）：
          {saved.knownExploited ? `該当（${saved.cves.replaceAll(",", "、")}）` : "該当しない"}
          。根拠：公開情報
        </p>
      )}
      {result && <KevResult view={result} roleLabel={p.roleLabel} />}
    </section>
  );
}

function KevResult({ view, roleLabel }: { view: KevMatchView; roleLabel: string }) {
  const m = view.match;
  const tone = KEV_STATUS_TONE[m.versionStatus];
  const anyBypass = m.matched.some((x) => x.authBypass === true);
  const unknownBypass =
    m.matched.length > 0 && !anyBypass && m.matched.some((x) => x.authBypass === undefined);
  return (
    <div className="kev-result">
      <p className="kev-verdict">
        <span className={`st ${tone}`}>{KEV_STATUS_LABEL[m.versionStatus]}</span>{" "}
        {m.product ? (
          <>
            <b>{m.product.labelJa}</b>
            {m.version ? (
              <>
                　版 <code>{m.version}</code>
              </>
            ) : null}
          </>
        ) : null}
      </p>
      <p className="small">{m.reasonJa}</p>
      {m.versionStatus === "unknown" && (
        <p className="small kev-note amber">
          未確認のため、カルテの属性は変えていません。判定は黄（未確認）のままです。
          {m.product?.versionHintJa && !m.version ? `版の書き方：${m.product.versionHintJa}` : ""}
        </p>
      )}
      {m.versionStatus === "affected" && (
        <div className="small kev-note red">
          <p>
            この構成要素（{roleLabel}
            ）は、悪用が確認された脆弱性の影響を受ける版です。判定ルールは「悪用確認済みの脆弱性に該当」として
            <b>突破される（赤）</b>にします。<b>装置の更新（M1051）</b>
            で修正版に上げれば、この材料は消えます。
          </p>
          {anyBypass && (
            <p>
              該当する CVE は<b>認証を回避する型</b>
              なので、VPN
              接続に多要素認証を付けても、この侵入は止まりません（判定ルールの「効かない緩和策」に出ます）。
            </p>
          )}
          {unknownBypass && (
            <p>
              該当する CVE
              が認証を回避するかはベンダーの資料に明記がないため、多要素認証の効き目は判断していません。
            </p>
          )}
        </div>
      )}
      {m.versionStatus === "not_affected" && (
        <p className="small kev-note green">
          範囲を確認した脆弱性には該当しません。カルテの「悪用確認済みの脆弱性に該当」は「該当しない」（根拠：公開情報）になりました。
          判定が緑になるかは、装置の更新（M1051）の運用の登録しだいです。
        </p>
      )}
      {view.applied.contradictions.length > 0 && (
        <div className="small kev-note amber">
          {view.applied.contradictions.map((c) => (
            <p key={c.messageJa}>
              <b>矛盾：</b>
              {c.messageJa}
            </p>
          ))}
        </div>
      )}
      {m.matched.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table className="evidence kev-table">
            <thead>
              <tr>
                <th>CVE</th>
                <th>内容</th>
                <th>ランサムウェアでの悪用</th>
                <th>CISA の対応期限</th>
                <th>影響を受ける版</th>
                <th>修正版</th>
                <th>出典（確認日）</th>
              </tr>
            </thead>
            <tbody>
              {m.matched.map((x) => (
                <tr key={x.cve}>
                  <td>
                    <code>{x.cve}</code>
                    {x.authBypass === true && (
                      <>
                        <br />
                        <span className="st red">認証回避</span>
                      </>
                    )}
                  </td>
                  <td>
                    {x.kindJa}
                    {x.entry?.vulnerabilityName && (
                      <>
                        <br />
                        <span className="muted">{x.entry.vulnerabilityName}</span>
                      </>
                    )}
                    {x.noteJa && (
                      <>
                        <br />
                        <span className="muted">{x.noteJa}</span>
                      </>
                    )}
                  </td>
                  <td>
                    {x.entry
                      ? x.entry.knownRansomwareCampaignUse === "Known"
                        ? "あり（Known）"
                        : "不明（Unknown）"
                      : "KEV に項目なし"}
                  </td>
                  <td>{x.entry?.dueDate ?? "―"}</td>
                  <td>{x.affectedJa}</td>
                  <td>{x.fixedJa}</td>
                  <td>
                    <a href={x.sourceUrl} target="_blank" rel="noreferrer noopener">
                      ベンダーの公表資料
                    </a>
                    <br />
                    <span className="muted">{x.checkedAt} 確認</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {m.versionStatus === "not_affected" && m.cleared.length > 0 && (
        <p className="muted small">範囲を確認して該当しなかった CVE：{m.cleared.join("、")}</p>
      )}
      {m.unverified.length > 0 && (
        <details className="small kev-unverified">
          <summary>
            KEV にはこの製品の脆弱性が他に {m.unverified.length}{" "}
            件あります（版の範囲は未確認。該当するかはベンダーに確認を）
          </summary>
          <ul>
            {m.unverified.map((u) => {
              const e = m.entries.find((x) => x.cveID === u.cve);
              return (
                <li key={u.cve}>
                  <code>{u.cve}</code> {e?.vulnerabilityName ?? ""}
                  {e
                    ? `（KEV 追加 ${e.dateAdded}、ランサムウェア ${e.knownRansomwareCampaignUse === "Known" ? "あり" : "不明"}）`
                    : ""}
                  {u.noteJa ? <span className="muted">　{u.noteJa}</span> : null}
                </li>
              );
            })}
          </ul>
        </details>
      )}
      {m.product && m.entries.length === 0 && (
        <p className="muted small">
          カタログ版 {m.catalogVersion} の時点で、{m.product.labelJa} の項目は KEV にありません。
        </p>
      )}
      <p className="muted small kev-sources">
        出典：
        {m.sourcesJa.map((s) => (
          <span key={s}>
            {s}
            <br />
          </span>
        ))}
        製品名と版は Claude に送られません（突き合わせはプログラムが行います）
      </p>
    </div>
  );
}
