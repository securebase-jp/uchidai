/**
 * ベンダーへの確認依頼（S7）：未確認の各行に「ベンダーに確認する」ボタン、送信箱、回答が届いたときの知らせ、
 * 選んだ対策ボタンの依頼文の下書き（担当者が確認してから送る）
 */
import { useEffect, useState } from "react";
import type { MeasureDraftView } from "../../shared/requests.ts";
import { useApp } from "../hooks/useApp.tsx";
import { useRequests } from "../hooks/useRequests.ts";
import { requestsApi } from "../lib/requestsApi.ts";
import { OutboxPanel } from "./OutboxPanel.tsx";
import "./requests.css";

export function RequestPanel() {
  const app = useApp();
  const { knowledge, profile, evaluation, measureIds } = app;
  const req = useRequests();
  const [toast, setToast] = useState<string>();
  const [draft, setDraft] = useState<MeasureDraftView>();
  const [draftFor, setDraftFor] = useState<string>();
  const [drafting, setDrafting] = useState(false);

  useEffect(() => {
    if (!req.lastAnswer) return;
    const a = req.lastAnswer;
    setToast(
      `${a.answer.answeredBy} から回答：${a.assetLabel}は「${a.choiceLabelJa}」。判定を更新しました`,
    );
    const t = setTimeout(() => setToast(undefined), 8000);
    return () => clearTimeout(t);
  }, [req.lastAnswer]);

  if (!profile || !knowledge) return null;
  const current = evaluation?.profile ?? profile;
  const mit = (id: string) =>
    knowledge.labels.mitigations[id] ?? knowledge.labels.custom[id]?.labelJa ?? id;
  const pending = current.assets.flatMap((a) =>
    a.controls
      .filter((c) => c.status === "unknown")
      .map((c) => ({ assetId: a.id, asset: a.label, mitigation: c.mitigation, noteJa: c.noteJa })),
  );
  const openFor = (assetId: string, mitigation: string) =>
    req.items.find((r) => r.assetId === assetId && r.mitigation === mitigation && !r.answer);
  const selectedMeasures = knowledge.measures.filter((m) => measureIds.includes(m.id));

  async function makeDraft(measureId: string) {
    if (!profile) return;
    setDrafting(true);
    setDraftFor(measureId);
    try {
      setDraft(await requestsApi.measureDraft(profile, measureId));
    } catch (e) {
      setDraft({
        subject: "",
        text: e instanceof Error ? e.message : "下書きを作れませんでした",
        mailtoUrl: "",
        writer: "template",
      });
    } finally {
      setDrafting(false);
    }
  }

  return (
    <div className="panel">
      <h2>ベンダーへの確認依頼（未確認の項目を 1 問ずつ聞く）</h2>
      <p className="muted">
        送るのは選択式の 1
        問だけ。回答が届くと、その場で判定を更新します（根拠：ベンダー回答。誰がいつ答えたかを記録）。
        カルテはサーバに送らず、会社名・対象の名前・質問だけを渡します。
      </p>
      {req.error && <p className="err small">{req.error}</p>}
      {pending.length === 0 ? (
        <p className="muted" style={{ marginTop: 8 }}>
          未確認の項目はありません。
        </p>
      ) : (
        <div style={{ marginTop: 6 }}>
          {pending.map((x) => {
            const open = openFor(x.assetId, x.mitigation);
            const key = `${x.assetId}:${x.mitigation}`;
            return (
              <div className="req-row" key={key}>
                <div className="what">
                  <b>
                    {x.asset}　<code>{x.mitigation}</code> {mit(x.mitigation)}
                  </b>
                  {x.noteJa && <span className="muted">{x.noteJa}</span>}
                </div>
                {open ? (
                  <span className="st amber">依頼済み・回答待ち</span>
                ) : (
                  <button
                    type="button"
                    className="btn sm primary"
                    disabled={req.busyKey !== undefined}
                    onClick={() => void req.create(x.assetId, x.mitigation)}
                  >
                    {req.busyKey === key ? "依頼文を作成中…" : "ベンダーに確認する"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
      <OutboxPanel items={req.items} live={req.live} />
      {selectedMeasures.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <h2>対策の依頼文（下書き。確認してから送る）</h2>
          <div className="row">
            {selectedMeasures.map((m) => (
              <button
                type="button"
                className="btn sm"
                key={m.id}
                disabled={drafting}
                onClick={() => void makeDraft(m.id)}
              >
                {drafting && draftFor === m.id ? "作成中…" : `「${m.labelJa}」の依頼文`}
              </button>
            ))}
          </div>
          {draft && (
            <div className="mail">
              <div className="hd">
                <span>下書き（送信していません）</span>
                <span>文面：{draft.writer === "claude" ? "Claude" : "テンプレート"}</span>
                {draft.to && <span>宛先：{draft.to}</span>}
              </div>
              <p className="subj">{draft.subject}</p>
              <pre>{draft.text}</pre>
              {draft.mailtoUrl && (
                <p className="row" style={{ marginTop: 8 }}>
                  <a className="btn sm primary" href={draft.mailtoUrl}>
                    メールソフトで開く
                  </a>
                </p>
              )}
            </div>
          )}
        </div>
      )}
      {toast && (
        <output className="toast" aria-live="polite">
          {toast}
        </output>
      )}
    </div>
  );
}
