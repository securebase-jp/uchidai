/** 回答ページ（#/answer/:token）：ベンダーがスマホで開き、1 問に答える。縦長で大きなボタン */
import { useEffect, useState } from "react";
import type { AnswerPageView } from "../../shared/requests.ts";
import { Logo } from "../components/Logo.tsx";
import { ApiError } from "../lib/api.ts";
import { requestsApi } from "../lib/requestsApi.ts";
import "../components/requests.css";

export function Answer({ token }: { token: string }) {
  const [page, setPage] = useState<AnswerPageView>();
  const [error, setError] = useState<string>();
  const [choice, setChoice] = useState<string>();
  const [name, setName] = useState("");
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState<string>();

  useEffect(() => {
    requestsApi
      .page(token)
      .then(setPage)
      .catch((e) => setError(e instanceof ApiError ? e.message : "読み込めませんでした"));
  }, [token]);

  async function submit() {
    if (!choice || !name.trim()) return;
    setSending(true);
    try {
      const r = await requestsApi.answer(token, choice, name.trim());
      setDone(r.choiceLabelJa);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "送信できませんでした");
    } finally {
      setSending(false);
    }
  }

  return (
    <main className="answer">
      <a className="brand" href="#/">
        <Logo />
        <span className="brand-tag">確認のお願い</span>
      </a>
      {error && <p className="err">{error}</p>}
      {!page && !error && <p className="muted">読み込んでいます…</p>}
      {page && (done || page.answered) ? (
        <div className="done">
          <div className="mark" aria-hidden="true">
            ✓
          </div>
          <h1>回答を受け付けました</h1>
          <p className="muted" style={{ marginTop: 8 }}>
            {done
              ? `「${done}」として ${page.companyLabel} に届けました。`
              : "この質問には回答済みです。"}
            <br />
            このページは閉じて構いません。
          </p>
        </div>
      ) : page ? (
        <>
          <h1>{page.companyLabel} からの質問</h1>
          <p className="muted">
            対象：{page.assetLabel}。当てはまるものを 1 つ選び、お名前を入れて送ってください（1
            分ほど）。
          </p>
          <p className="q">{page.question.textJa}</p>
          {page.question.hintJa && <p className="hint">{page.question.hintJa}</p>}
          <div className="choices">
            {page.question.choices.map((c) => (
              <button
                type="button"
                key={c.id}
                className="opt-btn"
                aria-pressed={choice === c.id}
                onClick={() => setChoice(c.id)}
              >
                {c.labelJa}
                {choice === c.id ? (
                  <span aria-hidden="true">●</span>
                ) : (
                  <span aria-hidden="true">○</span>
                )}
              </button>
            ))}
          </div>
          <label className="name">
            お名前（会社名・担当者名）
            <input
              className="in"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例：〇〇サービス 田中"
              autoComplete="name"
            />
          </label>
          <button
            type="button"
            className="btn primary submit"
            disabled={!choice || !name.trim() || sending}
            onClick={() => void submit()}
          >
            {sending ? "送信中…" : "この内容で回答する"}
          </button>
          <div className="bg">
            <p>
              背景：攻撃の手法{" "}
              {page.background.techniqueId ? (
                <>
                  <code>{page.background.techniqueId}</code>（
                  {page.background.techniqueLabelJa ?? ""}）
                </>
              ) : (
                "（該当なし）"
              )}{" "}
              に対して、対策 <code>{page.background.mitigationId}</code>（
              {page.background.mitigationLabelJa}
              ）が効くかを判定するための材料です（MITRE ATT&CK の ID）。
            </p>
            {page.background.materialsJa && <p>判定の材料：{page.background.materialsJa}</p>}
            <p>この回答は、依頼した会社の手元の画面にだけ届きます。</p>
          </div>
        </>
      ) : null}
    </main>
  );
}
