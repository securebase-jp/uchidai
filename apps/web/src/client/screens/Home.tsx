/**
 * はじめに（#/）：自社で使う流れを 5 段で示し、各段に「いまの状態」を出す。
 * ① ドメインを外から見る（任意）→ ② 最初の5問 → ③ カルテの詳細 → ④ 記事を貼る（またはキー無しで記録済みの事例）→ ⑤ 結論。
 * 画面の文字は最小限にする：仕組みや安全面の説明は各段の見出し横の情報ボタン（i）の中にだけ出す。
 * 架空の会社（デモ精工）で試す導線とデモモードは脇に置く。
 */
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { CompanyChoiceList } from "../components/CompanyPicker.tsx";
import { InfoButton } from "../components/InfoButton.tsx";
import { useApp } from "../hooks/useApp.tsx";
import { ApiError, api } from "../lib/api.ts";
import { type HomeStep, homeSteps, type StepId } from "../lib/home-status.ts";
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
/** 記事を読めないサーバ（キー無し）だと分かったら覚えておき、次からは「記録済みの事例」のタブを先に出す */
const READ_UNAVAILABLE_KEY = "uchidai.home.readUnavailable.v1";

/** 各段の情報ボタンに出す説明（段の定義 leadJa のあとに続ける段落）。箇条書きにせず、です・ます調で書く */
const STEP_INFO: Record<StepId, { title: string; paragraphs: string[] }> = {
  domain: {
    title: "外部確認とは",
    paragraphs: [
      "対象のホストには一切アクセスしません。ポートスキャン、Web の取得、ログイン画面の確認、TLS 接続のどれも行わず、DNS の公開レコードと証明書の公開ログだけを参照します。",
      "所有の確認は DNS の TXT レコードで行い、24 時間で失効します。架空のドメインを入れると、記録した応答を再生して試せます。",
    ],
  },
  questions: {
    title: "最初の5問とは",
    paragraphs: [
      "文字入力はありません。2 分以内で終わります。回答はこのブラウザにだけ保存され、会社名はあとでカルテの画面で登録できます。",
    ],
  },
  profile: {
    title: "カルテの詳細とは",
    paragraphs: [
      "根拠は「外部確認」「ベンダー回答」「担当者登録」の順に強く扱います。未確認（分からない）は決して「止まる」とは扱いません。",
    ],
  },
  article: {
    title: "記事を貼るとは",
    paragraphs: [
      "記事は信頼できないデータとして扱い、指示文と分けて Claude に渡します。存在しない手法 ID や、攻撃の型（型紙）にない手法は破棄します。",
      "サーバに Claude API のキーが無いときはその旨が出ますので、「記録済みの事例」から選んでください。記録済みの事例は、IPA「中小企業のための実例で学ぶサイバーセキュリティリスク事例集」を Claude が読んだ結果の記録です。",
    ],
  },
  result: {
    title: "結論の見方",
    paragraphs: [
      "担当者画面では根拠と対策のボタンを、社長画面では自動再生を、社長向けの一枚では印刷と共有リンクを使えます。",
    ],
  },
};

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

const readUnavailable = {
  load: (): boolean => {
    try {
      return localStorage.getItem(READ_UNAVAILABLE_KEY) === "1";
    } catch {
      return false;
    }
  },
  save: () => {
    try {
      localStorage.setItem(READ_UNAVAILABLE_KEY, "1");
    } catch {
      /* 保存できなくても動作には影響しない */
    }
  },
  clear: () => {
    try {
      localStorage.removeItem(READ_UNAVAILABLE_KEY);
    } catch {
      /* 同上 */
    }
  },
};

export type ArticleTab = "url" | "text" | "pdf" | "recorded";

export function Home() {
  const app = useApp();
  const [recorded, setRecorded] = useState<Recorded[]>([]);
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [pdfName, setPdfName] = useState<string>();
  const [reading, setReading] = useState<"url" | "text" | "pdf">();
  const [readError, setReadError] = useState<{ message: string; keyMissing: boolean }>();
  const [recon] = useState(() => reconHints.load());
  // 既定のタブ：キーが無いと分かっているサーバでは「記録済みの事例」、それ以外は「URL」
  const [tab, setTab] = useState<ArticleTab>(() => (readUnavailable.load() ? "recorded" : "url"));

  useEffect(() => {
    api
      .recordedList()
      .then((r) => setRecorded(r.items))
      .catch(() => {});
    // サーバにキーが無ければ、初回から「記録済みの事例」を既定にする（まだ URL のままのときだけ切り替える）
    api
      .health()
      .then((h) => {
        if (h.readAvailable) {
          readUnavailable.clear();
          return;
        }
        readUnavailable.save();
        setTab((t) => (t === "url" ? "recorded" : t));
      })
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
      const keyMissing = e instanceof ApiError && e.status === 503;
      setReadError({
        message: e instanceof ApiError || e instanceof Error ? e.message : "読解に失敗しました",
        keyMissing,
      });
      if (keyMissing) readUnavailable.save();
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
        <div className="define lead">
          <span className="lead-line">
            サイバー攻撃被害のニュースを見て、「うちの会社は大丈夫か？」と、社長が聞く。日本企業ではよくある風習ですが、情シス担当はその都度、調査に大忙しです。
          </span>
          <span className="lead-line">
            ウチダイは「社長向けの一枚」をもって、情シス担当による説明を支援します。
            <InfoButton title="このツールの仕組み">
              <p>
                他社の被害の報道を貼ると、Claude
                が記事を読んで攻撃の段階を対応づけ、プログラムが自社の構成の上で「止められるか」を判定します。
              </p>
              <p>
                Claude
                は読む・言い換えるだけです。止まるかの判定、日数と金額、期限はプログラムが決めます。
              </p>
            </InfoButton>
          </span>
        </div>
      </section>

      <ol className="steps">
        {steps.map((s) => (
          <li className={`card step tone-${s.tone}`} key={s.id}>
            <div className="step-head">
              <span className="step-n" aria-hidden="true">
                {s.n}
              </span>
              <h2>
                {s.titleJa}
                <InfoButton title={STEP_INFO[s.id].title}>
                  <p>{s.leadJa}</p>
                  {s.noteJa && <p>{s.noteJa}</p>}
                  {STEP_INFO[s.id].paragraphs.map((t) => (
                    <p key={t}>{t}</p>
                  ))}
                </InfoButton>
              </h2>
              <span className="step-status">
                <b className={`step-tag ${s.tone}`}>{TONE_WORD[s.tone]}</b>
                {s.statusJa}
              </span>
            </div>
            {s.id === "article" ? (
              <ArticleStep
                tab={tab}
                onTab={(t) => {
                  setTab(t);
                  setReadError(undefined);
                }}
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
                  担当者画面
                </Go>
                <Go to="/exec" disabled={!ready}>
                  社長画面
                </Go>
                <Go to="/onepager" disabled={!ready}>
                  社長向けの一枚
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
                {s.id === "questions" && app.profile && app.profileSource !== "example" && (
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
        {!app.profile && <CompanyChoiceList leadJa="会社を選ぶ" />}
        <p className="small">
          架空の会社は上部の会社のチップからも選べます。
          <a className="tiny" href="?profile=demo-seiko&demo=1">
            デモモードを再生
          </a>
        </p>
      </aside>

      <div className="home-foot small muted">
        データの扱いと出典
        <InfoButton title="データの扱いと出典">
          <p>
            会社カルテはこのブラウザにだけ保存し、サーバには残しません。判定のたびに API
            へ渡しますが、保存はしません。
          </p>
          <p>
            Claude
            に送るのは記事と判定結果だけです。社名・製品名・ホスト名は送らず、出力は検証してから使います。
          </p>
          <p>
            対象ホストにはアクセスしません。外部確認は、所有を確認したドメインの DNS
            と証明書の公開ログだけを参照します。
          </p>
          <p>
            出典は MITRE ATT&amp;CK Enterprise
            {app.knowledge ? ` v${app.knowledge.attackVersion}` : ""}、IPA
            事例集、警察庁統計（入口候補の順）、個人情報保護委員会の資料です。ICS は対象外です。
          </p>
        </InfoButton>
      </div>
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

const TABS: [ArticleTab, string][] = [
  ["url", "URL"],
  ["text", "本文"],
  ["pdf", "PDF"],
  ["recorded", "記録済みの事例"],
];

type ArticleProps = {
  tab: ArticleTab;
  onTab(t: ArticleTab): void;
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

/** 記事の入力：URL／本文／PDF／記録済みの事例 の 4 つを切り替えて、一度に 1 つだけ見せる */
function ArticleStep(p: ArticleProps) {
  const busy = p.reading !== undefined;
  const panelId = "article-tab-panel";
  return (
    <div className="article-step">
      <div className="tabbar" role="tablist" aria-label="記事の入力方法">
        {TABS.map(([t, label]) => (
          <button
            type="button"
            key={t}
            role="tab"
            className="tab"
            aria-selected={p.tab === t}
            aria-controls={panelId}
            onClick={() => p.onTab(t)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="tabpanel" role="tabpanel" id={panelId}>
        {p.tab === "url" && (
          <div className="row">
            <input
              className="in"
              style={{ flex: 1, minWidth: 220 }}
              placeholder="https://…（報道記事や公的機関の事例の URL）"
              value={p.url}
              onChange={(e) => p.onUrl(e.target.value)}
              disabled={busy}
              aria-label="記事の URL"
            />
            <button
              type="button"
              className="btn sm primary"
              disabled={!p.url || busy}
              onClick={() => p.onRead("url")}
            >
              {p.reading === "url" ? "読んでいます…" : "URL を読む"}
            </button>
          </div>
        )}
        {p.tab === "text" && (
          <div className="stack">
            <textarea
              className="in"
              placeholder="記事の本文を貼り付け（40 文字以上）"
              value={p.text}
              onChange={(e) => p.onText(e.target.value)}
              disabled={busy}
              aria-label="記事の本文"
            />
            <div className="row">
              <button
                type="button"
                className="btn sm primary"
                disabled={p.text.length < 40 || busy}
                onClick={() => p.onRead("text")}
              >
                {p.reading === "text" ? "読んでいます…" : "本文を読む"}
              </button>
            </div>
          </div>
        )}
        {p.tab === "pdf" && (
          <div className="row">
            <label className="btn sm primary" aria-disabled={busy}>
              {p.reading === "pdf" ? "読んでいます…" : "PDF を選ぶ"}
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
            <span className="muted small">{p.pdfName ?? "20 MB まで"}</span>
          </div>
        )}
        {p.tab === "recorded" && (
          <div className="article-recorded">
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
        )}
        {p.tab !== "recorded" && (
          <p className="muted small" style={{ marginTop: 8 }}>
            サーバに Claude API のキーが必要です。
          </p>
        )}
        {p.error && (
          <div role="alert" style={{ marginTop: 8 }}>
            <p className="err small">{p.error.message}</p>
            {p.error.keyMissing && (
              <p className="small row" style={{ marginTop: 6 }}>
                このサーバでは記事を読めませんが、記録済みの事例（IPA 事例集）で判定まで進めます。
                <button type="button" className="btn sm" onClick={() => p.onTab("recorded")}>
                  記録済みの事例から選ぶ
                </button>
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
