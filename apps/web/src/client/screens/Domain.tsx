/**
 * 外部確認：自社のドメインについて、所有確認（DNS の TXT）→ DNS と証明書の公開ログの参照 → カルテへの反映。
 * 手順 1 トークン発行、2 所有確認、3 実行、4 反映。対象ホストにはアクセスしない（公開情報だけ）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ReconApplyPanel } from "../components/ReconApplyPanel.tsx";
import { ReconResultView } from "../components/ReconResultView.tsx";
import { useApp } from "../hooks/useApp.tsx";
import { ApiError } from "../lib/api.ts";
import {
  type AppliedView,
  FIXTURE_DOMAIN,
  type RunView,
  reconApi,
  type StatusView,
  type TokenView,
  type VerifyView,
} from "../lib/reconApi.ts";
import { reconHints } from "../lib/reconHints.ts";

const fmt = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("ja-JP");
};

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn sm"
      onClick={() => {
        navigator.clipboard
          ?.writeText(text)
          .then(() => {
            setDone(true);
            window.setTimeout(() => setDone(false), 1500);
          })
          .catch(() => {});
      }}
    >
      {done ? "コピーしました" : label}
    </button>
  );
}

export function Domain() {
  const app = useApp();
  const [domain, setDomain] = useState(() => reconHints.domain());
  const [status, setStatus] = useState<StatusView>();
  const [token, setToken] = useState<TokenView>();
  const [verify, setVerify] = useState<VerifyView>();
  const [run, setRun] = useState<RunView>();
  const [applied, setApplied] = useState<AppliedView>();
  const [appliedDone, setAppliedDone] = useState(false);
  const [busy, setBusy] = useState<"token" | "verify" | "run" | "apply">();
  const [error, setError] = useState<string>();
  /** 実行の結果（手順 3 の下）。実行が終わったらここへスクロールする（結果が画面の外に出て気づかないことがある） */
  const resultRef = useRef<HTMLDivElement>(null);
  const profile = app.profile;

  const fail = useCallback(
    (e: unknown) =>
      setError(e instanceof ApiError || e instanceof Error ? e.message : "通信に失敗しました"),
    [],
  );

  // 前回のドメインの状態（トークン発行済みか、所有確認が有効か）を読む
  const refreshStatus = useCallback(async (d: string) => {
    if (!d) return;
    try {
      setStatus(await reconApi.status(d));
    } catch {
      setStatus(undefined);
    }
  }, []);
  useEffect(() => {
    void refreshStatus(reconHints.domain());
  }, [refreshStatus]);

  const current = status?.domain === domain.trim().toLowerCase() ? status : undefined;
  const hasToken = !!token || !!current?.token;
  const verified =
    verify?.ok === true
      ? { verifiedAt: verify.verifiedAt, expiresAt: verify.expiresAt }
      : (current?.verified ?? undefined);
  const fixture = domain.trim().toLowerCase() === FIXTURE_DOMAIN;

  function reset() {
    setToken(undefined);
    setVerify(undefined);
    setRun(undefined);
    setApplied(undefined);
    setAppliedDone(false);
    setError(undefined);
  }

  async function issue(renew = false) {
    setBusy("token");
    setError(undefined);
    try {
      const t = await reconApi.token(domain, renew);
      setToken(t);
      setDomain(t.domain);
      reconHints.setDomain(t.domain);
      if (renew) setVerify(undefined);
      await refreshStatus(t.domain);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(undefined);
    }
  }
  async function check() {
    setBusy("verify");
    setError(undefined);
    try {
      const v = await reconApi.verify(domain);
      setVerify(v);
      await refreshStatus(v.domain);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(undefined);
    }
  }
  async function execute() {
    setBusy("run");
    setError(undefined);
    setAppliedDone(false);
    try {
      const r = await reconApi.run(domain, profile);
      setRun(r);
      setApplied(r.applied);
      setTimeout(
        () => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
        0,
      );
      reconHints.save({
        domain: r.domain,
        fixture: r.fixture,
        checkedAt: r.result.checkedAt,
        answersHints: r.answersHints,
      });
      await refreshStatus(r.domain);
    } catch (e) {
      fail(e);
      if (e instanceof ApiError && e.status === 403) {
        setVerify(undefined);
        await refreshStatus(domain);
      }
    } finally {
      setBusy(undefined);
    }
  }
  // 実行の後でカルテが変わった（読み込まれた）ときは、直前の結果で反映の一覧を作り直す
  useEffect(() => {
    if (!run || !profile || applied?.profile.id === profile.id) return;
    let alive = true;
    reconApi
      .apply(run.domain, profile)
      .then((a) => alive && setApplied(a))
      .catch((e) => alive && fail(e));
    return () => {
      alive = false;
    };
  }, [run, profile, applied, fail]);

  function commit() {
    if (!applied || !profile) return;
    setBusy("apply");
    app.setProfile(applied.profile, app.profileSource ?? "saved");
    reconHints.saveContradictions(
      applied.profile.id,
      applied.contradictions,
      new Date().toISOString(),
    );
    setAppliedDone(true);
    setBusy(undefined);
  }

  const record = token?.record ?? current?.token?.record;
  const instructions = token?.instructionsJa;

  return (
    <div className="stack" style={{ marginTop: 12 }}>
      <div className="panel">
        <h2>外部確認：自社のドメインを外から見る</h2>
        <p className="small" style={{ marginTop: 6 }}>
          所有を確認したドメインについて、<b>DNS の公開レコードと証明書の公開ログ（crt.sh）だけ</b>
          を参照し、VPN
          用と推定されるホスト名、SPF・DMARC、メールやホームページの提供元の手がかりを集めます。
          国の調査（IPA 事例集の脆弱性事例）で中小企業に実際に見つかった弱点の確認です。
        </p>
        <p className="small muted" style={{ marginTop: 6 }}>
          対象のホストには一切アクセスしません（ポートスキャン、Web の取得、ログイン画面の確認、TLS
          接続を含む）。所有確認は 24 時間で失効します。架空のドメイン <code>{FIXTURE_DOMAIN}</code>{" "}
          を入れると、記録した応答を再生して試せます。
        </p>
      </div>

      <div className="panel">
        <h2>手順 1　ドメインを入れてトークンを発行する</h2>
        <div className="row" style={{ marginTop: 8 }}>
          <input
            className="in"
            style={{ maxWidth: 360 }}
            placeholder="example.jp（国際化ドメイン名は xn-- の形）"
            value={domain}
            onChange={(e) => {
              setDomain(e.target.value);
              reset();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && domain && !busy) void issue();
            }}
          />
          <button
            type="button"
            className="btn primary"
            disabled={!domain || busy !== undefined}
            onClick={() => void issue()}
          >
            {hasToken ? "トークンを表示する" : "トークンを発行する"}
          </button>
          <button
            type="button"
            className="btn ghost sm"
            onClick={() => {
              setDomain(FIXTURE_DOMAIN);
              reset();
            }}
          >
            架空のドメインで試す
          </button>
          {hasToken && !fixture && (
            <button
              type="button"
              className="btn ghost sm"
              disabled={busy !== undefined}
              onClick={() => void issue(true)}
            >
              トークンを再発行する
            </button>
          )}
        </div>
        {record && (
          <div style={{ marginTop: 12 }}>
            {fixture ? (
              <p className="small">
                <span className="chip fiction">架空のドメインの記録を再生</span>
                　記録に所有確認の TXT が入っているので、DNS の設定は要りません。
              </p>
            ) : (
              <p className="small">
                次の TXT レコードを <b>{record.name}</b> の DNS
                に追加してください（名前は「@」または空欄）。
              </p>
            )}
            <div style={{ overflowX: "auto", marginTop: 6 }}>
              <table className="evidence">
                <tbody>
                  <tr>
                    <th>名前</th>
                    <td>
                      <code>{record.name}</code>
                    </td>
                    <td>
                      <CopyButton text={record.name} label="名前をコピー" />
                    </td>
                  </tr>
                  <tr>
                    <th>種別</th>
                    <td>
                      <code>TXT</code>
                    </td>
                    <td />
                  </tr>
                  <tr>
                    <th>値</th>
                    <td>
                      <code>{record.value}</code>
                    </td>
                    <td>
                      <CopyButton text={record.value} label="値をコピー" />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            {instructions && (
              <ul className="small muted" style={{ paddingLeft: 18, marginTop: 6 }}>
                {instructions.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <div className="panel">
        <h2>手順 2　所有を確認する</h2>
        <p className="small muted" style={{ marginTop: 6 }}>
          DNS の TXT
          レコードに上の値があるかを確かめます。反映には数分から数時間かかることがあります。
        </p>
        <p className="row" style={{ marginTop: 8 }}>
          <button
            type="button"
            className="btn primary"
            disabled={!hasToken || busy !== undefined}
            onClick={() => void check()}
          >
            所有を確認する
          </button>
          {verified && (
            <span className="st green">
              確認済み（{fmt(verified.verifiedAt)}）　有効期限 {fmt(verified.expiresAt)}
            </span>
          )}
          {verify && !verify.ok && <span className="st red">確認できませんでした</span>}
        </p>
        {verify && !verify.ok && (
          <div className="small" style={{ marginTop: 6 }}>
            <p className="err">{verify.reasonJa}</p>
            {verify.txtRecords.length > 0 && (
              <>
                <p className="muted">いま DNS にある TXT レコード：</p>
                <ul style={{ paddingLeft: 18 }}>
                  {verify.txtRecords.map((r) => (
                    <li key={r}>
                      <code>{r}</code>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </div>

      <div className="panel">
        <h2>手順 3　外部確認を実行する</h2>
        <p className="small muted" style={{ marginTop: 6 }}>
          DNS（TXT・MX・A・AAAA・CNAME・PTR）と証明書の公開ログを参照します。crt.sh への問い合わせは
          1 ドメインにつき 1 回で、応答は 24 時間キャッシュします。
        </p>
        <p className="row" style={{ marginTop: 8 }}>
          <button
            type="button"
            className="btn primary"
            disabled={!verified || busy !== undefined}
            onClick={() => void execute()}
          >
            {busy === "run" ? "確認しています…" : "外部確認を実行する"}
          </button>
          {run?.ctUnavailableJa && <span className="st amber">{run.ctUnavailableJa}</span>}
        </p>
      </div>

      {error && <p className="err">{error}</p>}

      <div ref={resultRef}>
        {run && <ReconResultView result={run.result} fixture={run.fixture} />}
      </div>

      {run && (
        <div className="panel">
          <h2>手順 4　カルテに反映する</h2>
          {!profile ? (
            <div className="small">
              <p>
                会社カルテがまだありません。外部から推定した 5
                問の初期値はこのブラウザに保存しました。
                「最初の5問」で該当の質問に初期選択として出ます（合っているかを確かめるだけで進めます）。
              </p>
              <p className="row" style={{ marginTop: 8 }}>
                <a className="btn primary" href="#/questions">
                  最初の5問に答える
                </a>
                <button
                  type="button"
                  className="btn"
                  onClick={() => void app.loadExample("demo-seiko")}
                >
                  架空の会社（デモ精工）のカルテを読む
                </button>
              </p>
            </div>
          ) : appliedDone ? (
            <div className="small">
              <p className="st green">反映しました</p>
              <p style={{ marginTop: 8 }}>
                担当者画面の「矛盾（外部確認と登録内容の食い違い）」の欄と、各資産の根拠の種類を確認してください。
              </p>
              <p className="row" style={{ marginTop: 8 }}>
                <a className="btn primary" href="#/staff">
                  担当者画面へ
                </a>
              </p>
            </div>
          ) : applied && applied.profile.id === profile.id ? (
            <>
              <p className="small muted" style={{ marginTop: 6 }}>
                いまのカルテ：<b>{profile.companyName}</b>
                {profile.fictional && (
                  <span className="chip fiction" style={{ marginLeft: 6 }}>
                    架空の会社
                  </span>
                )}
              </p>
              <div style={{ marginTop: 10 }}>
                <ReconApplyPanel
                  before={profile}
                  applied={applied}
                  busy={busy !== undefined}
                  onApply={commit}
                />
              </div>
            </>
          ) : (
            <p className="muted small">反映の一覧を作っています…</p>
          )}
        </div>
      )}
    </div>
  );
}
