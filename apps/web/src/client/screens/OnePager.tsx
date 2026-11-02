/**
 * 社長向けの一枚（#/onepager）。縦長の紙を画面に置き、ブラウザの印刷で PDF にする。
 * 共有リンク（主）：#/onepager?d=<内容を圧縮した文字列>。一枚の内容がそのまま URL に入り、社長のスマホでも開ける。
 * 共有リンク（ID 形式。架空の会社の記録向け）：#/onepager?profile=demo-seiko&case=ipa-case-1&measures=vpn-update
 */
import { useEffect, useMemo, useState } from "react";
import { useApp } from "../hooks/useApp.tsx";
import {
  buildShareHash,
  encodeShare,
  sharePayloadFrom,
  shareSizeNoteJa,
  supportsShare,
} from "../lib/onepager-share.ts";
import {
  OnePagerView,
  viewDataFromResponse,
  viewDataFromShare,
} from "../onepager/OnePagerView.tsx";
import { useOnePagerParams } from "../onepager/params.ts";
import { useOnePager } from "../onepager/useOnePager.ts";

const absolute = (hash: string) => `${location.origin}${location.pathname}${hash}`;

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    prompt("このリンクをコピーしてください", text);
    return false;
  }
}

export function OnePager() {
  const app = useApp();
  const params = useOnePagerParams();
  const state = useOnePager(params);
  const [copied, setCopied] = useState<string>();
  const [shareNote, setShareNote] = useState<string>();
  const [shareError, setShareError] = useState<string>();
  const canShare = supportsShare();

  const view = useMemo(() => {
    if (state.status === "ready") return viewDataFromResponse(state.data);
    if (state.status === "shared") return viewDataFromShare(state.payload);
    return undefined;
  }, [state]);

  // 一枚が変わったら、題名を付け替え、前の一枚のリンクの知らせは消す
  useEffect(() => {
    const prev = document.title;
    if (view) document.title = `社長向けの一枚_${view.onePager.companyName}`;
    setShareNote(undefined);
    setShareError(undefined);
    setCopied(undefined);
    return () => {
      document.title = prev;
    };
  }, [view]);

  const measureLabel = (m: string) =>
    app.knowledge?.labels.mitigations[m] ?? app.knowledge?.labels.custom[m]?.labelJa ?? "";

  function flash(key: string) {
    setCopied(key);
    setTimeout(() => setCopied(undefined), 1800);
  }

  /** 内容を載せた共有リンク（主）。圧縮はブラウザの中で行い、サーバには送らない */
  async function copyContentLink() {
    if (state.status !== "ready") return;
    setShareError(undefined);
    try {
      const d = await encodeShare(sharePayloadFrom(state.data));
      const url = absolute(buildShareHash(d));
      setShareNote(shareSizeNoteJa(url.length));
      if (await copyText(url)) flash("content");
    } catch (e) {
      setShareError(
        `共有リンクを作れませんでした（${e instanceof Error ? e.message : String(e)}）`,
      );
    }
  }

  async function copyCurrentLink() {
    if (await copyText(location.href)) flash("current");
  }

  async function copyIdLink(hash: string) {
    if (await copyText(absolute(hash))) flash("id");
  }

  return (
    <div className="onepager">
      <div className="op-toolbar no-print">
        <button type="button" className="btn primary" onClick={() => window.print()}>
          PDF で保存（印刷）
        </button>
        {state.status === "ready" && (
          <>
            <button
              type="button"
              className="btn"
              onClick={() => void copyContentLink()}
              disabled={!canShare}
              title={
                canShare
                  ? "一枚の内容を圧縮して URL に載せたリンクを作ります（サーバには保存しません）"
                  : "このブラウザは圧縮（CompressionStream）に対応していないため、共有リンクを作れません"
              }
            >
              {copied === "content" ? "コピーしました" : "共有リンクをコピー"}
            </button>
            {state.idShareHash && (
              <button
                type="button"
                className="btn ghost sm"
                onClick={() => void copyIdLink(state.idShareHash ?? "")}
                title={state.idShareHash}
              >
                {copied === "id" ? "コピーしました" : "短いリンク（架空の会社の記録を指す形）"}
              </button>
            )}
          </>
        )}
        {state.status === "shared" && (
          <>
            <button type="button" className="btn" onClick={() => void copyCurrentLink()}>
              {copied === "current" ? "コピーしました" : "このリンクをコピー"}
            </button>
            <a className="btn ghost sm" href="#/">
              自分の会社で試す
            </a>
          </>
        )}
      </div>
      {state.status === "ready" && (
        <div className="op-toolbar no-print small muted" style={{ display: "block" }}>
          {shareError ? (
            <span className="err">{shareError}</span>
          ) : shareNote ? (
            shareNote
          ) : (
            <>
              共有リンクには一枚の内容がそのまま入ります（数 KB の長い URL
              になります）。会社カルテと経路図は入れません。サーバには何も保存しないので、リンクを受け取った人はカルテが無いスマホでもこの一枚を開けます。
              {!canShare && " このブラウザでは共有リンクを作れません（圧縮に未対応）。"}
            </>
          )}
        </div>
      )}
      {state.status === "shared" && (
        <div className="op-toolbar no-print small muted" style={{ display: "block" }}>
          共有リンクに含まれた内容を表示しています。会社カルテは読んでいません。開いた時点での再計算もしていません。
        </div>
      )}
      {state.status === "loading" && <p className="muted">一枚を作っています…</p>}
      {state.status === "missing" && (
        <div className="panel">
          <p>{state.reasonJa}</p>
          <p className="row" style={{ marginTop: 8 }}>
            <a className="btn primary" href="#/">
              はじめにへ
            </a>
            <button
              type="button"
              className="btn"
              onClick={() => (location.hash = "#/onepager?profile=demo-seiko&case=ipa-case-1")}
            >
              架空の会社（デモ精工）の一枚を見る
            </button>
          </p>
        </div>
      )}
      {state.status === "error" && (
        <div className="panel">
          <p className="err">{state.messageJa}</p>
          {params.d && (
            <p className="row" style={{ marginTop: 8 }}>
              <a className="btn primary" href="#/">
                はじめにへ
              </a>
            </p>
          )}
        </div>
      )}
      {view && <OnePagerView data={view} measureLabel={measureLabel} />}
    </div>
  );
}
