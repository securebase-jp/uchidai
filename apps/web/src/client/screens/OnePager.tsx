/**
 * 社長向けの一枚（#/onepager）。縦長の紙を画面に置き、ブラウザの印刷で PDF にする。
 * 共有リンク：#/onepager?profile=demo-seiko&case=ipa-case-1&measures=vpn-update
 */
import { useEffect, useState } from "react";
import { useApp } from "../hooks/useApp.tsx";
import { OnePagerView } from "../onepager/OnePagerView.tsx";
import { useOnePagerParams } from "../onepager/params.ts";
import { useOnePager } from "../onepager/useOnePager.ts";

export function OnePager() {
  const app = useApp();
  const params = useOnePagerParams();
  const state = useOnePager(params);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const prev = document.title;
    if (state.status === "ready")
      document.title = `社長向けの一枚_${state.data.onePager.companyName}`;
    return () => {
      document.title = prev;
    };
  }, [state]);

  const measureLabel = (m: string) =>
    app.knowledge?.labels.mitigations[m] ?? app.knowledge?.labels.custom[m]?.labelJa ?? "";

  async function copyLink(hash: string) {
    const url = `${location.origin}${location.pathname}${hash}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      prompt("このリンクをコピーしてください", url);
    }
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
              onClick={() => void copyLink(state.shareHash)}
              disabled={!state.shareable}
              title={
                state.shareable
                  ? state.shareHash
                  : "このカルテはこのブラウザにしか無いので、リンクでは再現できません"
              }
            >
              {copied ? "コピーしました" : "共有リンクをコピー"}
            </button>
            <span className="muted small">
              {state.shareable
                ? "リンクだけで同じ一枚を開けます（スマホでも読めます）"
                : "カルテがこのブラウザにしか無いため、リンクは共有できません"}
            </span>
          </>
        )}
      </div>
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
      {state.status === "error" && <p className="err">{state.messageJa}</p>}
      {state.status === "ready" && <OnePagerView data={state.data} measureLabel={measureLabel} />}
    </div>
  );
}
