/**
 * 記事の入力：URL／本文／PDF（と、渡されたときだけ「記録済みの事例」）を切り替えて、一度に 1 つだけ見せる。
 * はじめにの段 4 と、上部バーの「記事を貼る…」の吹き出しの両方がこの部品を使う。
 * 読み込みに成功したら事例にして（setCase、担当者が選んだ事例）、担当者画面へ移る
 */
import { useState } from "react";
import { useApp } from "../hooks/useApp.tsx";
import { useReadAvailable } from "../hooks/useReadAvailable.ts";
import { ApiError, api } from "../lib/api.ts";
import { DAMAGE_LABEL } from "../lib/company-choices.ts";
import { readUnavailable } from "../lib/read-available.ts";

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
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [pdfName, setPdfName] = useState<string>();
  const [reading, setReading] = useState<"url" | "text" | "pdf">();
  const [readError, setReadError] = useState<{ message: string; keyMissing: boolean }>();
  // 既定のタブ：キーが無いと分かっているサーバでは「記録済みの事例」（あれば）、それ以外は「URL」。
  // 後から分かったときは、まだ URL のままのときだけ切り替える
  const [picked, setPicked] = useState<ArticleTab>();
  const tab: ArticleTab = picked ?? (recorded && readAvailable === false ? "recorded" : "url");
  const tabs = TABS.filter(([t]) => t !== "recorded" || recorded);
  const busy = reading !== undefined;
  const panelId = "article-tab-panel";

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
      onDone?.();
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
          <div className="row">
            <input
              className="in"
              style={{ flex: 1, minWidth: 0 }}
              placeholder="https://…（報道記事や公的機関の事例の URL）"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={busy}
              aria-label="記事の URL"
            />
            <button
              type="button"
              className="btn sm primary"
              disabled={!url || busy}
              onClick={() => void read("url")}
            >
              {reading === "url" ? "読んでいます…" : "URL を読む"}
            </button>
          </div>
        )}
        {tab === "text" && (
          <div className="stack">
            <textarea
              className="in"
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
