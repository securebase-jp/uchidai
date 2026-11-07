/**
 * 記事の入力：URL／本文／PDF（と、渡されたときだけ「記録済みの事例」）を切り替えて、一度に 1 つだけ見せる。
 * はじめにの段 4 と、上部バーの「記事を貼る…」の吹き出しの両方がこの部品を使う。
 * 読み込みに成功したら事例にして（setCase、担当者が選んだ事例）、担当者画面へ移る
 */
import { useEffect, useRef, useState } from "react";
import { type FetchFailReason, MAX_SERIES_URLS, type SeriesFailure } from "../../shared/api.ts";
import { useApp } from "../hooks/useApp.tsx";
import { useReadAvailable } from "../hooks/useReadAvailable.ts";
import { ApiError, api } from "../lib/api.ts";
import { DAMAGE_LABEL } from "../lib/company-choices.ts";
import { fetchFailureGuide, pastesFor } from "../lib/fetch-failure.ts";
import { readUnavailable } from "../lib/read-available.ts";
import { caseMetaFromRead } from "../lib/read-result.ts";
import { FetchFailures } from "./FetchFailures.tsx";
import { InfoButton } from "./InfoButton.tsx";

/** PDF の上限（API の base64 上限 28,000,000 文字に収まる大きさ） */
const MAX_PDF_BYTES = 20 * 1024 * 1024;

export type RecordedItem = { caseId: string; title: string; damageType: string };
export type ArticleTab = "url" | "text" | "pdf" | "recorded";

const TABS: [ArticleTab, string][] = [
  ["url", "URL"],
  ["text", "本文"],
  ["pdf", "PDF"],
  ["recorded", "記録済みの事例"],
];

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

type Props = {
  /** 渡すと「記録済みの事例」のタブが加わる（キーが無いと分かっているサーバでは先に出す） */
  recorded?: { items: RecordedItem[]; current: string | undefined; onPick(id: string): void };
  /** 読み込みに成功して事例にしたあと（吹き出しを閉じるなど） */
  onDone?(): void;
};

export function ArticleInput({ recorded, onDone }: Props) {
  const app = useApp();
  const readAvailable = useReadAvailable();
  // URL の欄。2 件目以降は「同じ事故の続報を追加」で足す（最大 MAX_SERIES_URLS 件）
  const [urls, setUrls] = useState<string[]>([""]);
  const filledUrls = urls.map((u) => u.trim()).filter((u) => u !== "");
  const [text, setText] = useState("");
  const [pdfName, setPdfName] = useState<string>();
  const [reading, setReading] = useState<"url" | "text" | "pdf">();
  // 取得に失敗した公表の代わりに貼った本文（URL ごと）
  const [pastes, setPastes] = useState<Record<string, string>>({});
  // 本文の欄へ移したら、そこへフォーカスを移す（取得に失敗して「本文を貼って読む」を押したとき）
  const textBox = useRef<HTMLTextAreaElement>(null);
  const [focusText, setFocusText] = useState(false);
  // 本文として読むとき、出所として付ける URL（取得に失敗した URL。入力済みの URL は残す）
  const [textSource, setTextSource] = useState<string>();
  const [readError, setReadError] = useState<{
    message: string;
    keyMissing: boolean;
    /** 記事を取得できなかった（URL・PDF）。本文を貼って読む入口を添える */
    canPaste: boolean;
    /** 取得できなかった理由（案内の一文を出し分ける） */
    reason?: FetchFailReason;
    /** 複数の公表を読んで取得に失敗したもの（どの URL がなぜか） */
    failures?: SeriesFailure[];
  }>();
  // 既定のタブ：キーが無いと分かっているサーバでは「記録済みの事例」（あれば）、それ以外は「URL」。
  // 後から分かったときは、まだ URL のままのときだけ切り替える
  const [picked, setPicked] = useState<ArticleTab>();
  const tab: ArticleTab = picked ?? (recorded && readAvailable === false ? "recorded" : "url");
  const tabs = TABS.filter(([t]) => t !== "recorded" || recorded);
  const busy = reading !== undefined;
  const panelId = "article-tab-panel";

  // biome-ignore lint/correctness/useExhaustiveDependencies: 欄が現れたとき（tab、focusText が変わったとき）だけ移す
  useEffect(() => {
    if (focusText && tab === "text") {
      textBox.current?.focus();
      setFocusText(false);
    }
  }, [focusText, tab]);

  async function read(kind: "url" | "text" | "pdf", pdf?: File, onError: "fail" | "skip" = "fail") {
    setReading(kind);
    setReadError(undefined);
    try {
      const input =
        kind === "url"
          ? filledUrls.length > 1
            ? ({
                kind: "urls",
                urls: filledUrls,
                onError,
                ...(pastesFor(pastes, filledUrls).length > 0
                  ? { pastes: pastesFor(pastes, filledUrls) }
                  : {}),
              } as const)
            : ({ kind: "url", url: filledUrls[0] ?? "" } as const)
          : kind === "text"
            ? ({ kind: "text", text, ...(textSource ? { sourceUrl: textSource } : {}) } as const)
            : ({ kind: "pdf", dataBase64: toBase64(await (pdf as File).arrayBuffer()) } as const);
      const r = await api.read(input);
      app.setCase(r.case, caseMetaFromRead(r));
      location.hash = "/staff";
      onDone?.();
    } catch (e) {
      // キーが無いサーバは 503（文言はサーバ）。記録済みの事例へ自然に流す
      const keyMissing = e instanceof ApiError && e.status === 503;
      setReadError({
        message: e instanceof ApiError || e instanceof Error ? e.message : "読解に失敗しました",
        keyMissing,
        // 取得できなかった記事（404、ログインや有料の壁、タイムアウトなど）は 400 で返る。本文を貼れば取得を介さずに読める
        canPaste: kind !== "text" && e instanceof ApiError && e.status === 400,
        ...(e instanceof ApiError && e.reason ? { reason: e.reason } : {}),
        ...(e instanceof ApiError && e.failures ? { failures: e.failures } : {}),
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
        canPaste: true,
      });
      return;
    }
    setPdfName(file.name);
    void read("pdf", file);
  }

  return (
    <div className="article-step">
      <div className="tabbar" role="tablist" aria-label="記事の入力方法">
        {tabs.map(([t, label]) => (
          <button
            type="button"
            key={t}
            role="tab"
            className="tab"
            aria-selected={tab === t}
            aria-controls={panelId}
            onClick={() => {
              setPicked(t);
              setReadError(undefined);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="tabpanel" role="tabpanel" id={panelId}>
        {tab === "url" && (
          <div className="stack">
            {urls.map((u, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: 欄は位置で区別する（並べ替えない）
              <div className="row" key={i}>
                <input
                  className="in"
                  style={{ flex: 1, minWidth: 0 }}
                  placeholder={
                    i === 0
                      ? "https://…（報道記事や公的機関の事例の URL）"
                      : "https://…（同じ事故の続報の URL）"
                  }
                  value={u}
                  onChange={(e) => setUrls(urls.map((x, j) => (j === i ? e.target.value : x)))}
                  disabled={busy}
                  aria-label={i === 0 ? "記事の URL" : `続報の URL（${i + 1} 件目）`}
                />
                {i > 0 && (
                  <button
                    type="button"
                    className="btn sm"
                    disabled={busy}
                    onClick={() => setUrls(urls.filter((_, j) => j !== i))}
                    aria-label={`${i + 1} 件目の URL を外す`}
                  >
                    外す
                  </button>
                )}
              </div>
            ))}
            <div className="row">
              <button
                type="button"
                className="btn sm primary"
                disabled={filledUrls.length === 0 || busy}
                onClick={() => void read("url")}
              >
                {reading === "url"
                  ? "読んでいます…"
                  : filledUrls.length > 1
                    ? `${filledUrls.length} 件をまとめて読む`
                    : "URL を読む"}
              </button>
              {urls.length < MAX_SERIES_URLS && (
                <button
                  type="button"
                  className="btn sm"
                  disabled={busy}
                  onClick={() => setUrls([...urls, ""])}
                >
                  ＋ 同じ事故の続報を追加
                </button>
              )}
              <InfoButton title="続報を追加すると">
                <p>
                  同じ事故の第一報と続報など、最大 {MAX_SERIES_URLS} 件の URL
                  を、公表日の順にひとつの事故として読みます。日付が読み取れないものがあるときは、入力した順に並べます。
                </p>
                <p>
                  報の間で変わったこと（入口が分かった、可能性が確認になった、など）は、担当者画面の表と、社長向けの一枚に出ます。変わったかどうかの判定は、Claude
                  ではなくプログラムが行います。
                </p>
              </InfoButton>
            </div>
          </div>
        )}
        {tab === "text" && (
          <div className="stack">
            <textarea
              className="in"
              ref={textBox}
              placeholder="記事の本文を貼り付け（40 文字以上）"
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={busy}
              aria-label="記事の本文"
            />
            <div className="row">
              <button
                type="button"
                className="btn sm primary"
                disabled={text.length < 40 || busy}
                onClick={() => void read("text")}
              >
                {reading === "text" ? "読んでいます…" : "本文を読む"}
              </button>
            </div>
          </div>
        )}
        {tab === "pdf" && (
          <div className="row">
            <label className="btn sm primary" aria-disabled={busy}>
              {reading === "pdf" ? "読んでいます…" : "PDF を選ぶ"}
              <input
                type="file"
                accept="application/pdf,.pdf"
                style={{ display: "none" }}
                disabled={busy}
                onChange={(e) => {
                  pickPdf(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </label>
            <span className="muted small">{pdfName ?? "20 MB まで"}</span>
          </div>
        )}
        {tab === "recorded" && recorded && (
          <div className="article-recorded">
            {recorded.items.map((r) => (
              <label className="opt" key={r.caseId}>
                <input
                  type="radio"
                  name="case"
                  checked={recorded.current === r.caseId}
                  onChange={() => recorded.onPick(r.caseId)}
                />
                <span>
                  <b>{DAMAGE_LABEL[r.damageType] ?? r.damageType}</b>　{r.title}
                  <br />
                  <span className="muted">{r.caseId.replace("ipa-case-", "被害事例 ")}</span>
                </span>
              </label>
            ))}
            {recorded.items.length === 0 && <p className="muted small">記録を読み込んでいます…</p>}
          </div>
        )}
        {tab !== "recorded" && (
          <p className="muted small" style={{ marginTop: 8 }}>
            サーバに Claude API のキーが必要です。
          </p>
        )}
        {readError && (
          <div role="alert" style={{ marginTop: 8 }}>
            <p className="err small">{readError.message}</p>
            {readError.failures && readError.failures.length > 0 && (
              <>
                <FetchFailures
                  failures={readError.failures}
                  pastes={pastes}
                  onPaste={(url, t) => setPastes({ ...pastes, [url]: t })}
                  disabled={busy}
                />
                {pastesFor(
                  pastes,
                  readError.failures.map((f) => f.url),
                ).length > 0 && (
                  <p className="small row" style={{ marginTop: 6 }}>
                    <button
                      type="button"
                      className="btn sm primary"
                      disabled={busy}
                      onClick={() => void read("url", undefined, "skip")}
                    >
                      貼った本文も入れて読む
                    </button>
                  </p>
                )}
                {readError.failures.length < filledUrls.length && (
                  <p className="small row" style={{ marginTop: 6 }}>
                    <button
                      type="button"
                      className="btn sm"
                      disabled={busy}
                      onClick={() => void read("url", undefined, "skip")}
                    >
                      取得できた分だけで読む
                    </button>
                  </p>
                )}
              </>
            )}
            {readError.canPaste && !readError.failures && (
              <div className="small" style={{ marginTop: 6 }}>
                <p className="muted">{fetchFailureGuide(readError.reason).textJa}</p>
                <div className="row" style={{ marginTop: 6 }}>
                  <button
                    type="button"
                    className="btn sm"
                    onClick={() => {
                      // 入力済みの URL は残し、本文の欄へ切り替えてフォーカスする。URL が 1 件なら出所として付ける
                      setTextSource(filledUrls.length === 1 ? filledUrls[0] : undefined);
                      setPicked("text");
                      setFocusText(true);
                      setReadError(undefined);
                    }}
                  >
                    本文を貼って読む
                  </button>
                  <InfoButton title="取得できなかったとき">
                    {fetchFailureGuide(readError.reason).detailJa.map((t) => (
                      <p key={t}>{t}</p>
                    ))}
                  </InfoButton>
                </div>
              </div>
            )}
            {readError.keyMissing && (
              <p className="small row" style={{ marginTop: 6 }}>
                このサーバでは記事を読めませんが、記録済みの事例（IPA 事例集）で判定まで進めます。
                {recorded && (
                  <button type="button" className="btn sm" onClick={() => setPicked("recorded")}>
                    記録済みの事例から選ぶ
                  </button>
                )}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
