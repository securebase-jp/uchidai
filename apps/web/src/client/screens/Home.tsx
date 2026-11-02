/**
 * はじめに（#/）：自社で使う流れを 5 段で示し、各段に「いまの状態」を出す。
 * ① ドメインを外から見る（任意）→ ② 最初の5問 → ③ カルテの詳細 → ④ 記事を貼る（またはキー無しで記録済みの事例）→ ⑤ 結論。
 * 架空の会社（デモ精工）で試す導線とデモモードは脇に置く。
 */
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../hooks/useApp.tsx";
import { ApiError, api } from "../lib/api.ts";
import { type HomeStep, homeSteps } from "../lib/home-status.ts";
import { pendingCount } from "../lib/profile.ts";
import { reconHints } from "../lib/reconHints.ts";

type Recorded = { caseId: string; title: string; damageType: string };
const DAMAGE: Record<string, string> = {
  ransomware: "業務停止",
  bec: "なりすまし送金",
  data_breach: "情報漏えい",
  out_of_scope: "対象外",
};
const TONE_WORD: Record<HomeStep["tone"], string> = {
  done: "済",
  todo: "未",
  optional: "任意",
  warn: "要確認",
};
/** PDF の上限（API の base64 上限 28,000,000 文字に収まる大きさ） */
const MAX_PDF_BYTES = 20 * 1024 * 1024;

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function Home() {
  const app = useApp();
  const [recorded, setRecorded] = useState<Recorded[]>([]);
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [pdfName, setPdfName] = useState<string>();
  const [reading, setReading] = useState<"url" | "text" | "pdf">();
  const [readError, setReadError] = useState<{ message: string; keyMissing: boolean }>();
  const [recon] = useState(() => reconHints.load());

  useEffect(() => {
    api
      .recordedList()
      .then((r) => setRecorded(r.items))
      .catch(() => {});
  }, []);

  const steps = useMemo(
    () =>
      homeSteps({
        recon: recon
          ? { domain: recon.domain, fixture: recon.fixture, checkedAt: recon.checkedAt }
          : undefined,
        profile: app.profile
          ? {
              companyName: app.profile.companyName,
              fictional: app.profile.fictional,
              pending: pendingCount(app.profile),
            }
          : undefined,
        profileSource: app.profileSource,
        theCase: app.theCase
          ? {
              title: app.theCase.title,
              chosen: app.caseChosen,
              ...(app.caseMeta?.recorded ? { recordedId: app.caseMeta.recorded.caseId } : {}),
            }
          : undefined,
      }),
    [recon, app.profile, app.profileSource, app.theCase, app.caseMeta, app.caseChosen],
  );

  async function read(kind: "url" | "text" | "pdf", pdf?: File) {
    setReading(kind);
    setReadError(undefined);
    try {
      const input =
        kind === "url"
          ? ({ kind: "url", url } as const)
          : kind === "text"
            ? ({ kind: "text", text } as const)
            : ({ kind: "pdf", dataBase64: toBase64(await (pdf as File).arrayBuffer()) } as const);
      const r = await api.read(input);
      app.setCase(r.case, {
        label: r.case.title,
        sourceJa: `Claude が記事を読解（${r.model}）`,
        ...(r.article.sourceUrl ? { sourceUrl: r.article.sourceUrl } : {}),
      });
      location.hash = "/staff";
    } catch (e) {
      // キーが無いサーバは 503（文言はサーバ）。記録済みの事例へ自然に流す
      setReadError({
        message: e instanceof ApiError || e instanceof Error ? e.message : "読解に失敗しました",
        keyMissing: e instanceof ApiError && e.status === 503,
      });
    } finally {
      setReading(undefined);
    }
  }

  function pickPdf(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_PDF_BYTES) {
      setReadError({
        message: "PDF が大きすぎます（20 MB まで）。該当ページだけを書き出してください。",
        keyMissing: false,
      });
      return;
    }
    setPdfName(file.name);
    void read("pdf", file);
  }

  const current = app.caseMeta?.recorded?.caseId;
  const ready = Boolean(app.profile && app.theCase);

  return (
    <div className="home">
      <section className="hero">
        <h1>うちの会社は大丈夫？</h1>
        <p className="define">「その対策、この攻撃に効きますか？」に、根拠つきで答える道具。</p>
        <p>
          他社の被害の報道を貼ると、Claude
          が記事を読んで攻撃の段階を対応づけ、プログラムが自社の構成の上で「止められるか」を判定します。
          Claude は読む・言い換えるだけ。止まるかの判定、日数と金額、期限はプログラムが決めます。
        </p>
      </section>

      <ol className="steps">
        {steps.map((s) => (
          <li className={`card step tone-${s.tone}`} key={s.id}>
            <div className="step-head">
              <span className="step-n" aria-hidden="true">
                {s.n}
              </span>
              <h2>{s.titleJa}</h2>
              <span className="step-status">
                <b className={`step-tag ${s.tone}`}>{TONE_WORD[s.tone]}</b>
                {s.statusJa}
              </span>
            </div>
            <p className="muted small">{s.leadJa}</p>
            {s.id === "article" ? (
              <ArticleStep
                recorded={recorded}
                current={current}
                onPick={(id) => void app.loadRecorded(id)}
                url={url}
                onUrl={setUrl}
                text={text}
                onText={setText}
                pdfName={pdfName}
                onPdf={pickPdf}
                reading={reading}
                error={readError}
                onRead={(k) => void read(k)}
              />
            ) : s.id === "result" ? (
              <div className="row" style={{ marginTop: 10 }}>
                <Go to="/staff" disabled={!ready} primary>
                  担当者画面（根拠と対策ボタン）
                </Go>
                <Go to="/exec" disabled={!ready}>
                  社長画面（自動再生）
                </Go>
                <Go to="/onepager" disabled={!ready}>
                  社長向けの一枚（印刷・共有リンク）
                </Go>
              </div>
            ) : (
              <div className="row" style={{ marginTop: 10 }}>
                <Go
                  to={(s.href ?? "#/").replace(/^#/, "")}
                  disabled={s.disabled ?? false}
                  primary={s.tone === "todo" || s.tone === "warn"}
                >
                  {s.actionJa}
                </Go>
                {s.id === "questions" && app.profile && (
                  <button type="button" className="btn ghost sm" onClick={app.clearProfile}>
                    カルテを消す
                  </button>
                )}
              </div>
            )}
          </li>
        ))}
      </ol>

      <aside className="home-aside">
        <p className="small">
          自社のカルテを作る前に動きを見たいときは、
          <button
            type="button"
            className="link"
            onClick={() => {
              void app.loadExample("demo-seiko");
              location.hash = "/staff";
            }}
          >
            架空の会社（デモ精工・製造業 120 名）で試す
          </button>
          。
          <a className="tiny" href="?profile=demo-seiko&demo=1">
            デモモードを再生
          </a>
        </p>
      </aside>

      <ul className="promises small">
        <li>
          <b className="promise-head">会社カルテはこのブラウザにだけ保存。</b>
          サーバには残しません（判定のたびに API へ渡しますが保存しません）。
        </li>
        <li>
          <b className="promise-head">Claude に送るのは記事と判定結果だけ。</b>
          社名・製品名・ホスト名は送らず、出力は検証してから使います。
        </li>
        <li>
          <b className="promise-head">対象ホストにはアクセスしません。</b>
          外部確認は所有を確認したドメインの DNS と証明書の公開ログだけを参照します。
        </li>
      </ul>
      <p className="muted small" style={{ marginTop: 8 }}>
        出典：MITRE ATT&amp;CK Enterprise
        {app.knowledge ? ` v${app.knowledge.attackVersion}` : ""}、IPA
        事例集、警察庁統計（入口候補の順）、個人情報保護委員会の資料。ICS は対象外です。
      </p>
      {app.error && (
        <p className="err" style={{ marginTop: 12 }}>
          {app.error}
        </p>
      )}
    </div>
  );
}

/** 画面へ移るボタン（前の段が済んでいないときは押せない） */
function Go({
  to,
  disabled,
  primary,
  children,
}: {
  to: string;
  disabled: boolean;
  primary?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`btn ${primary ? "primary" : ""}`}
      disabled={disabled}
      onClick={() => {
        location.hash = to;
      }}
    >
      {children}
    </button>
  );
}

type ArticleProps = {
  recorded: Recorded[];
  current: string | undefined;
  onPick(id: string): void;
  url: string;
  onUrl(v: string): void;
  text: string;
  onText(v: string): void;
  pdfName: string | undefined;
  onPdf(file: File | undefined): void;
  reading: "url" | "text" | "pdf" | undefined;
  error: { message: string; keyMissing: boolean } | undefined;
  onRead(kind: "url" | "text"): void;
};

function ArticleStep(p: ArticleProps) {
  const busy = p.reading !== undefined;
  const recordedRef = useRef<HTMLDivElement>(null);
  const goRecorded = () => {
    recordedRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    recordedRef.current?.querySelector<HTMLInputElement>("input[type=radio]")?.focus({
      preventScroll: true,
    });
  };
  return (
    <div className="article-step">
      <div className="article-paste">
        <h3>記事を貼る（サーバに Claude API のキーが必要）</h3>
        <div className="stack">
          <div className="row">
            <input
              className="in"
              style={{ flex: 1, minWidth: 220 }}
              placeholder="https://…（報道記事や公的機関の事例の URL）"
              value={p.url}
              onChange={(e) => p.onUrl(e.target.value)}
              disabled={busy}
            />
            <button
              type="button"
              className="btn sm"
              disabled={!p.url || busy}
              onClick={() => p.onRead("url")}
            >
              {p.reading === "url" ? "読んでいます…" : "URL を読む"}
            </button>
          </div>
          <textarea
            className="in"
            placeholder="記事の本文を貼り付け（40 文字以上）"
            value={p.text}
            onChange={(e) => p.onText(e.target.value)}
            disabled={busy}
          />
          <div className="row">
            <button
              type="button"
              className="btn sm"
              disabled={p.text.length < 40 || busy}
              onClick={() => p.onRead("text")}
            >
              {p.reading === "text" ? "読んでいます…" : "本文を読む"}
            </button>
            <label className="btn sm" aria-disabled={busy}>
              {p.reading === "pdf" ? "読んでいます…" : "PDF を読む"}
              <input
                type="file"
                accept="application/pdf,.pdf"
                style={{ display: "none" }}
                disabled={busy}
                onChange={(e) => {
                  p.onPdf(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </label>
            {p.pdfName && <span className="muted small">{p.pdfName}</span>}
          </div>
          {p.error && (
            <div role="alert">
              <p className="err small">{p.error.message}</p>
              {p.error.keyMissing && (
                <p className="small" style={{ marginTop: 6 }}>
                  このサーバでは記事を読めませんが、記録済みの事例（IPA 事例集 5
                  件）で判定まで進めます。
                  <button type="button" className="btn sm" onClick={goRecorded}>
                    記録済みの事例から選ぶ
                  </button>
                </p>
              )}
            </div>
          )}
          <p className="muted small">
            記事は信頼できないデータとして扱い、指示文と分けて渡します。存在しない手法 ID
            や型紙にない手法は破棄します。キーが無いサーバではその旨が出るので、下の記録済みの事例から選んでください。
          </p>
        </div>
      </div>
      <div className="article-recorded" ref={recordedRef}>
        <h3>記録済みの事例から選ぶ（キー不要）</h3>
        <p className="muted small">
          IPA「中小企業のための実例で学ぶサイバーセキュリティリスク事例集」を Claude
          が読んだ結果の記録です。
        </p>
        <div style={{ marginTop: 6 }}>
          {p.recorded.map((r) => (
            <label className="opt" key={r.caseId}>
              <input
                type="radio"
                name="case"
                checked={p.current === r.caseId}
                onChange={() => p.onPick(r.caseId)}
              />
              <span>
                <b>{DAMAGE[r.damageType] ?? r.damageType}</b>　{r.title}
                <br />
                <span className="muted">{r.caseId.replace("ipa-case-", "被害事例 ")}</span>
              </span>
            </label>
          ))}
          {p.recorded.length === 0 && <p className="muted small">記録を読み込んでいます…</p>}
        </div>
      </div>
    </div>
  );
}
