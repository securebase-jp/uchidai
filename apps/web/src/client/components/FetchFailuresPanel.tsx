/**
 * 担当者画面：読めた分だけで読んだとき、取得に失敗した公表を一覧で残し、一つずつ本文を貼って差し替えて読み直せる。
 * 読み直しは、読めた公表の URL と、貼った本文（URL ごと）をサーバへ渡すだけ。失敗した URL へは取得に行かない
 */
import { useState } from "react";
import { useApp } from "../hooks/useApp.tsx";
import { ApiError, api } from "../lib/api.ts";
import { pastesFor } from "../lib/fetch-failure.ts";
import { caseMetaFromRead } from "../lib/read-result.ts";
import { FetchFailures } from "./FetchFailures.tsx";

export function FetchFailuresPanel() {
  const app = useApp();
  const meta = app.caseMeta;
  const failures = meta?.fetchFailures ?? [];
  const [pastes, setPastes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  if (!meta || failures.length === 0) return null;

  // 読めた公表の URL と、失敗した URL（重複は除く）
  const readUrls = meta.series
    ? meta.series.parts.map((p) => p.url)
    : meta.sourceUrl
      ? [meta.sourceUrl]
      : [];
  const urls = [...new Set([...readUrls, ...failures.map((f) => f.url)])];
  const ready = pastesFor(
    pastes,
    failures.map((f) => f.url),
  );

  async function reread() {
    setBusy(true);
    setError(undefined);
    try {
      const r = await api.read({ kind: "urls", urls, onError: "skip", pastes: ready });
      app.setCase(r.case, caseMetaFromRead(r));
      setPastes({});
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : "読解に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel fetch-failures-panel">
      <FetchFailures
        failures={failures}
        pastes={pastes}
        onPaste={(url, t) => setPastes({ ...pastes, [url]: t })}
        disabled={busy}
      />
      {ready.length > 0 && (
        <p className="small row" style={{ marginTop: 6 }}>
          <button
            type="button"
            className="btn sm primary"
            disabled={busy}
            onClick={() => void reread()}
          >
            {busy ? "読んでいます…" : "貼った本文も入れて読み直す"}
          </button>
        </p>
      )}
      {error && (
        <p className="err small" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
