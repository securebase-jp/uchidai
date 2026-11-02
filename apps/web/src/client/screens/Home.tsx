/** はじめに：会社カルテと事例を選ぶ。記事の読解はキーがあるときだけ */
import { useEffect, useState } from "react";
import { useApp } from "../hooks/useApp.tsx";
import { ApiError, api } from "../lib/api.ts";

type Recorded = { caseId: string; title: string; damageType: string };
const DAMAGE: Record<string, string> = {
  ransomware: "業務停止",
  bec: "なりすまし送金",
  data_breach: "情報漏えい",
  out_of_scope: "対象外",
};

export function Home() {
  const app = useApp();
  const [recorded, setRecorded] = useState<Recorded[]>([]);
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState<string>();

  useEffect(() => {
    api
      .recordedList()
      .then((r) => setRecorded(r.items))
      .catch(() => {});
  }, []);

  async function read(kind: "url" | "text") {
    setReading(true);
    setReadError(undefined);
    try {
      const r = await api.read(kind === "url" ? { kind: "url", url } : { kind: "text", text });
      app.setCase(r.case, {
        label: r.case.title,
        sourceJa: `Claude が記事を読解（${r.model}）`,
        ...(r.article.sourceUrl ? { sourceUrl: r.article.sourceUrl } : {}),
      });
      location.hash = "/staff";
    } catch (e) {
      setReadError(e instanceof ApiError || e instanceof Error ? e.message : "読解に失敗しました");
    } finally {
      setReading(false);
    }
  }

  const current = app.caseMeta?.recorded?.caseId;
  return (
    <div>
      <section className="hero">
        <h1>うちの会社は、大丈夫？</h1>
        <p>
          報道と同じ攻撃が自社の構成をどう進むかを図で再生し、「止められる」か「大丈夫ではない」かを根拠つきで示します。
          Claude
          は記事を読むだけ。止まるかどうかの判定、日数と金額の計算はプログラムが決定的に行います。
        </p>
      </section>
      <div className="cards">
        <div className="card">
          <h2>0. 自社のドメイン（任意）</h2>
          <p className="muted small">
            所有を確認したドメインについて、DNS の公開レコードと証明書の公開ログだけを参照し、VPN
            用と推定されるホスト名や SPF・DMARC
            を確かめます。結果は5問の初期値とカルテに反映できます。対象ホストにはアクセスしません。
          </p>
          <div className="row" style={{ marginTop: 10 }}>
            <a className="btn primary" href="#/domain">
              外部確認を始める
            </a>
          </div>
        </div>
        <div className="card">
          <h2>1. 会社カルテ</h2>
          {app.profile ? (
            <p className="small">
              いまのカルテ：<b>{app.profile.companyName}</b>
              {app.profile.fictional && (
                <span className="chip fiction" style={{ marginLeft: 6 }}>
                  架空の会社
                </span>
              )}
              <span className="muted">
                （
                {app.profileSource === "answers"
                  ? "5問の回答から"
                  : app.profileSource === "example"
                    ? "架空企業の例"
                    : "このブラウザに保存済み"}
                ）
              </span>
            </p>
          ) : (
            <p className="muted small">まだありません。</p>
          )}
          <div className="row" style={{ marginTop: 10 }}>
            <a className="btn primary" href="#/questions">
              最初の5問に答える
            </a>
            <button
              type="button"
              className="btn"
              onClick={() => void app.loadExample("demo-seiko")}
            >
              架空の会社（デモ精工・製造業 120 名）で試す
            </button>
            {app.profile && (
              <button type="button" className="btn ghost sm" onClick={app.clearProfile}>
                カルテを消す
              </button>
            )}
          </div>
          <p className="muted small" style={{ marginTop: 10 }}>
            カルテはこのブラウザの localStorage
            にだけ保存されます。サーバには送られません（判定のたびに API
            へ渡しますが保存しません）。
          </p>
        </div>
        <div className="card">
          <h2>2. 事例（報道・事例集）</h2>
          <p className="muted small">キー無しで動く、記録済みの読解結果から選べます。</p>
          <div style={{ marginTop: 6 }}>
            {recorded.map((r) => (
              <label className="opt" key={r.caseId}>
                <input
                  type="radio"
                  name="case"
                  checked={current === r.caseId}
                  onChange={() => void app.loadRecorded(r.caseId)}
                />
                <span>
                  <b>{DAMAGE[r.damageType] ?? r.damageType}</b>　{r.title}
                  <br />
                  <span className="muted">
                    IPA「中小企業のための実例で学ぶサイバーセキュリティリスク事例集」
                    {r.caseId.replace("ipa-case-", "被害事例 ")}
                  </span>
                </span>
              </label>
            ))}
          </div>
          <details style={{ marginTop: 10 }}>
            <summary className="small">
              記事の URL か本文を貼って、Claude に読ませる（サーバに API キーが必要）
            </summary>
            <div className="stack" style={{ marginTop: 8 }}>
              <input
                className="in"
                placeholder="https://…（報道記事や公的機関の事例の URL）"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
              <button
                type="button"
                className="btn sm"
                disabled={!url || reading}
                onClick={() => void read("url")}
              >
                URL を読む
              </button>
              <textarea
                className="in"
                placeholder="記事の本文を貼り付け"
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              <button
                type="button"
                className="btn sm"
                disabled={text.length < 40 || reading}
                onClick={() => void read("text")}
              >
                本文を読む
              </button>
              {reading && <p className="muted small">Claude が読んでいます…</p>}
              {readError && <p className="err small">{readError}</p>}
              <p className="muted small">
                記事は信頼できないデータとして扱い、指示文と分けて渡します。存在しない手法 ID
                や型紙にない手法は破棄します。
              </p>
            </div>
          </details>
        </div>
        <div className="card">
          <h2>3. 見る</h2>
          <div className="row">
            <a className="btn primary" href="#/staff">
              担当者画面（操作型）
            </a>
            <a className="btn" href="#/exec">
              社長画面（自動再生）
            </a>
          </div>
          <p className="muted small" style={{ marginTop: 10 }}>
            担当者画面では手法 ID・緩和策
            ID・根拠の種類・記事中の根拠文を表示し、対策ボタンで再判定できます。社長画面は 30〜40
            秒の一本の物語で、専門用語を出しません。
          </p>
          <p className="muted small" style={{ marginTop: 10 }}>
            出典：MITRE ATT&amp;CK Enterprise{" "}
            {app.knowledge ? `v${app.knowledge.attackVersion}` : ""}、IPA
            事例集、警察庁統計（入口候補の順）。 外部確認は所有確認したドメインの DNS
            と証明書の公開ログだけを参照し、対象ホストにはアクセスしません。ICS は対象外です。
          </p>
        </div>
      </div>
      {app.error && (
        <p className="err" style={{ marginTop: 12 }}>
          {app.error}
        </p>
      )}
    </div>
  );
}
