/**
 * 社長向けの一枚（#/onepager）。縦長の紙を画面に置き、ブラウザの印刷で PDF にする。
 * 共有リンク（主）：#/onepager?d=<内容を圧縮した文字列>。一枚の内容がそのまま URL に入り、社長のスマホでも開ける。
 *   開く側は SharedOnePager（AppProvider の外。カルテ・知識・判定の API を一切呼ばない。回答ページと同じ扱い）
 * 共有リンク（ID 形式。架空の会社の記録向け）：#/onepager?profile=demo-seiko&case=ipa-case-1&measures=vpn-update
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { CaseChoiceList, CompanyChoiceList } from "../components/CompanyPicker.tsx";
import { InfoButton } from "../components/InfoButton.tsx";
import { useApp } from "../hooks/useApp.tsx";
import {
  buildShareHash,
  decodeShare,
  encodeShare,
  type SharePayload,
  sharePayloadFrom,
  shareSizeNoteJa,
  supportsShare,
} from "../lib/onepager-share.ts";
import {
  generatedAtJa,
  OnePagerView,
  viewDataFromResponse,
  viewDataFromShare,
} from "../onepager/OnePagerView.tsx";
import { useOnePagerParams } from "../onepager/params.ts";
import { useOnePager } from "../onepager/useOnePager.ts";
import { usePrintPreview } from "../onepager/usePrintPreview.ts";

const absolute = (hash: string) => `${location.origin}${location.pathname}${hash}`;

/** クリップボードに書けなければ false（呼ぶ側がリンクを画面に出して手でコピーしてもらう） */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** 「印刷の見え方を確認」：印刷と同じ規則を画面に当てる（A4 の紙・余白 15mm・白地・改ページの位置） */
function PrintPreviewToggle({ preview, onToggle }: { preview: boolean; onToggle(): void }) {
  return (
    <button
      type="button"
      className="btn"
      aria-pressed={preview}
      onClick={onToggle}
      title="印刷（A4 縦・白地・余白 15mm）と同じ体裁で画面に表示します。実際の改ページはブラウザの印刷プレビューで確かめてください"
    >
      {preview ? "画面の表示に戻す" : "印刷の見え方を確認"}
    </button>
  );
}

/**
 * 一枚を作っている間に見せる紙の骨組み：見出しの位置に薄い帯を置き、空の画面にしない。
 * 段の構成は OnePagerView と同じ（表題、結論、何が起きるか、止まる業務、お金、期限、対策）
 */
function OnePagerSkeleton() {
  const sections = [
    "結論",
    "何が起きるか",
    "止まる業務と日数",
    "お金への影響の目安",
    "期限",
    "対策",
  ];
  return (
    <div className="op-paper op-skeleton" aria-hidden="true">
      <div className="op-head op-skel-block">
        <span className="op-skel w-20 h-sm" />
        <span className="op-skel w-60 h-lg" />
        <span className="op-skel w-40 h-sm" />
      </div>
      {sections.map((name, i) => (
        <div className="op-sec op-skel-block" key={name}>
          <span className="op-skel w-30 h-sm" />
          <span className={`op-skel ${i === 0 ? "w-90 h-xl" : "w-100 h-md"}`} />
          {i !== 0 && <span className="op-skel w-70 h-md" />}
        </div>
      ))}
    </div>
  );
}

/** API で作る一枚（自分のカルテ、または架空の会社の記録）。共有リンク（d=）で開いた一枚は SharedOnePager */
export function OnePager() {
  const app = useApp();
  const params = useOnePagerParams();
  const state = useOnePager(params);
  const [copied, setCopied] = useState<string>();
  const [shareNote, setShareNote] = useState<string>();
  const [shareError, setShareError] = useState<string>();
  /** クリップボードに書けなかったときに画面に出すリンク（手でコピーしてもらう） */
  const [manualLink, setManualLink] = useState<string>();
  const manualRef = useRef<HTMLInputElement>(null);
  const canShare = supportsShare();
  const print = usePrintPreview();

  const view = useMemo(() => {
    if (state.status === "ready")
      return viewDataFromResponse(state.data, new Date(), { entryUnknown: state.entryUnknown });
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
    setManualLink(undefined);
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

  /** コピーできなかったリンクを画面に出し、全選択して手でコピーしてもらう */
  function showManual(url: string) {
    setManualLink(url);
    setTimeout(() => {
      manualRef.current?.focus();
      manualRef.current?.select();
    }, 0);
  }

  /** 内容を載せた共有リンク（主）。圧縮はブラウザの中で行い、サーバには送らない */
  async function copyContentLink() {
    if (state.status !== "ready") return;
    setShareError(undefined);
    try {
      const d = await encodeShare(
        sharePayloadFrom(state.data, new Date(), { entryUnknown: state.entryUnknown }),
      );
      const url = absolute(buildShareHash(d));
      setShareNote(shareSizeNoteJa(url.length));
      if (await copyText(url)) flash("content");
      else showManual(url);
    } catch (e) {
      setShareError(
        `共有リンクを作れませんでした（${e instanceof Error ? e.message : String(e)}）`,
      );
    }
  }

  async function copyIdLink(hash: string) {
    if (await copyText(absolute(hash))) flash("id");
    else showManual(absolute(hash));
  }

  return (
    <div className="onepager">
      <div className="op-toolbar no-print">
        <button type="button" className="btn primary" onClick={() => window.print()}>
          PDF で保存（印刷）
        </button>
        <PrintPreviewToggle preview={print.preview} onToggle={print.toggle} />
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
            <InfoButton title="共有リンクについて" align="end">
              <p>
                共有リンクには一枚の内容がそのまま入ります。数 KB の長い URL
                になりますが、会社カルテと経路図は入れません。
              </p>
              <p>
                サーバには何も保存しないので、リンクを受け取った人はカルテが無いスマホでもこの一枚を開けます。
              </p>
              {!canShare && (
                <p>
                  このブラウザは圧縮（CompressionStream）に未対応のため、共有リンクを作れません。
                </p>
              )}
            </InfoButton>
          </>
        )}
      </div>
      {state.status === "ready" && (shareError || shareNote) && (
        <div className="op-toolbar no-print small muted" style={{ display: "block" }}>
          {shareError ? <span className="err">{shareError}</span> : shareNote}
        </div>
      )}
      {manualLink && (
        <div className="op-toolbar no-print small" style={{ display: "block" }}>
          <p className="muted">
            このブラウザではクリップボードに書けませんでした。下のリンクを選択してコピーしてください。
          </p>
          <input
            ref={manualRef}
            className="in"
            readOnly
            value={manualLink}
            aria-label="共有リンク"
            onFocus={(e) => e.target.select()}
          />
        </div>
      )}
      {state.status === "loading" && (
        <>
          <p className="muted" role="status">
            一枚を作っています…
          </p>
          <OnePagerSkeleton />
        </>
      )}
      {state.status === "missing" && (
        <div className="panel">
          {state.needs.profile && <CompanyChoiceList />}
          {state.needs.case && (
            <div style={state.needs.profile ? { marginTop: 16 } : undefined}>
              <CaseChoiceList />
            </div>
          )}
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

/**
 * 共有リンク（d=）で受け取った一枚。AppProvider の外で描く：知識（/api/knowledge）も判定も読まないので、
 * 公開 URL（Cloudflare Tunnel など）から開いて API が 403 でもエラーにならない。緩和策の名前は要らない（経路図は無い）
 */
export function SharedOnePager({ d }: { d: string }) {
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error"; messageJa: string }
    | { status: "shared"; payload: SharePayload }
  >({ status: "loading" });
  const [copied, setCopied] = useState(false);
  const [manualLink, setManualLink] = useState<string>();
  const manualRef = useRef<HTMLInputElement>(null);
  const print = usePrintPreview();

  useEffect(() => {
    let alive = true;
    setState({ status: "loading" });
    setCopied(false);
    setManualLink(undefined);
    decodeShare(d).then((r) => {
      if (!alive) return;
      setState(
        r.ok
          ? { status: "shared", payload: r.payload }
          : { status: "error", messageJa: `共有リンクを開けませんでした。${r.reasonJa}` },
      );
    });
    return () => {
      alive = false;
    };
  }, [d]);

  const view = useMemo(
    () => (state.status === "shared" ? viewDataFromShare(state.payload) : undefined),
    [state],
  );
  useEffect(() => {
    const prev = document.title;
    if (view) document.title = `社長向けの一枚_${view.onePager.companyName}`;
    return () => {
      document.title = prev;
    };
  }, [view]);

  async function copyCurrentLink() {
    if (await copyText(location.href)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } else {
      setManualLink(location.href);
      setTimeout(() => {
        manualRef.current?.focus();
        manualRef.current?.select();
      }, 0);
    }
  }

  return (
    <div className="onepager">
      <div className="op-toolbar no-print">
        <button type="button" className="btn primary" onClick={() => window.print()}>
          PDF で保存（印刷）
        </button>
        <PrintPreviewToggle preview={print.preview} onToggle={print.toggle} />
        <button type="button" className="btn" onClick={() => void copyCurrentLink()}>
          {copied ? "コピーしました" : "このリンクをコピー"}
        </button>
        <a className="btn ghost sm" href="#/">
          自分の会社で試す
        </a>
      </div>
      {manualLink && (
        <div className="op-toolbar no-print small" style={{ display: "block" }}>
          <p className="muted">
            このブラウザではクリップボードに書けませんでした。下のリンクを選択してコピーしてください。
          </p>
          <input
            ref={manualRef}
            className="in"
            readOnly
            value={manualLink}
            aria-label="共有リンク"
            onFocus={(e) => e.target.select()}
          />
        </div>
      )}
      {state.status === "shared" && (
        <div className="op-toolbar no-print small" style={{ display: "block" }}>
          <p>
            <b>共有リンクで受け取った一枚です。</b>
            判定は{" "}
            {generatedAtJa(
              state.payload.generatedAt ? new Date(state.payload.generatedAt) : new Date(),
              true,
            )}{" "}
            時点のもので、開いた時点で再計算はしていません。
          </p>
          <p className="muted">
            出所：ウチダイで「{state.payload.onePager.companyName}」の担当者が作成（事例「
            {state.payload.onePager.caseTitle}」、「何が起きるか」の文は
            {state.payload.text.source === "claude" ? " Claude の言い換え" : " テンプレート文"}
            ）。会社カルテと経路図はこのリンクに含まれていません。
          </p>
        </div>
      )}
      {state.status === "loading" && (
        <>
          <p className="muted" role="status">
            一枚を開いています…
          </p>
          <OnePagerSkeleton />
        </>
      )}
      {state.status === "error" && (
        <div className="panel">
          <p className="err">{state.messageJa}</p>
          <p className="row" style={{ marginTop: 8 }}>
            <a className="btn primary" href="#/">
              はじめにへ
            </a>
          </p>
        </div>
      )}
      {view && <OnePagerView data={view} />}
    </div>
  );
}
