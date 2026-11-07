/**
 * ベンダーへの確認依頼（S7）：未確認の各行に「ベンダーに確認する」ボタン、送信箱、回答が届いたときの知らせ、
 * 選んだ対策ボタンの依頼文の下書き（担当者が確認してから送る）。
 * まとめて確認：未確認の行を最大 10 問まで選び、プレビュー（宛先と文面）を確認してから、1 通のメールにまとめて送信箱に積む。
 * デモモード（?demo=1）では、まとめて確認の操作を出さない（画面と動画は従来のまま）。
 */
import { useEffect, useRef, useState } from "react";
import {
  type BatchPreviewView,
  MAX_BATCH_ITEMS,
  type MeasureDraftView,
} from "../../shared/requests.ts";
import { isDemoMode } from "../demo/params.ts";
import { useApp } from "../hooks/useApp.tsx";
import { useRequests } from "../hooks/useRequests.tsx";
import {
  batchKey,
  looksLikeEmail,
  parseBatchKey,
  selectOnPath,
  toggleSelected,
} from "../lib/batchSelect.ts";
import { rankPending } from "../lib/pending.ts";
import { requestsApi } from "../lib/requestsApi.ts";
import { BatchPreview } from "./BatchPreview.tsx";
import { InfoButton } from "./InfoButton.tsx";
import { OutboxLink } from "./OutboxLink.tsx";
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
  const outboxRef = useRef<HTMLDivElement>(null);
  const batchUi = !isDemoMode();
  const [selected, setSelected] = useState<string[]>([]);
  const [preview, setPreview] = useState<BatchPreviewView>();
  const [previewTo, setPreviewTo] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const [batchError, setBatchError] = useState<string>();

  useEffect(() => {
    if (!req.lastAnswer) return;
    const a = req.lastAnswer;
    setToast(
      `${a.answer.answeredBy} さんの返信を入力しました：${a.assetLabel}は「${a.choiceLabelJa}」。判定を更新しました`,
    );
    const t = setTimeout(() => setToast(undefined), 8000);
    return () => clearTimeout(t);
  }, [req.lastAnswer]);

  if (!profile || !knowledge) return null;
  const current = evaluation?.profile ?? profile;
  const mit = (id: string) =>
    knowledge.labels.mitigations[id] ?? knowledge.labels.custom[id]?.labelJa ?? id;
  // 経路で問われている未確認を先頭に（答えると結論が変わりやすい順）
  const pending = rankPending(current, evaluation?.verdict, evaluation?.graph).map((x) => ({
    ...x,
    asset: x.assetLabel,
    noteJa: current.assets
      .find((a) => a.id === x.assetId)
      ?.controls.find((c) => c.mitigation === x.mitigation)?.noteJa,
  }));
  const onPathCount = pending.filter((x) => x.onPath).length;

  /** 依頼を作ったら、送信箱へ案内する（送信箱は画面の下にあり、作ったことに気づきにくい） */
  async function createAndShow(assetId: string, mitigation: string) {
    const r = await req.create(assetId, mitigation);
    if (!r) return;
    setToast("送信箱に確認依頼を作りました。メールの文面は下の送信箱にあります");
    setTimeout(() => setToast(undefined), 6000);
    outboxRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  const openFor = (assetId: string, mitigation: string) =>
    req.items.find((r) => r.assetId === assetId && r.mitigation === mitigation && !r.answer);
  const selectedMeasures = knowledge.measures.filter((m) => measureIds.includes(m.id));
  // まとめて選べるのは、まだ依頼していない行（依頼済みの行は「依頼済み・回答待ち」の札のまま）
  const selectable = (x: { assetId: string; mitigation: string }) =>
    !openFor(x.assetId, x.mitigation);
  const live = selected.filter((k) => {
    const { assetId, mitigation } = parseBatchKey(k);
    return (
      pending.some((x) => x.assetId === assetId && x.mitigation === mitigation) &&
      selectable({ assetId, mitigation })
    );
  });
  const atMax = live.length >= MAX_BATCH_ITEMS;
  const onPathRows = pending.map((x) => ({
    key: batchKey(x.assetId, x.mitigation),
    onPath: Boolean(x.onPath),
    selectable: selectable(x),
  }));
  const onPathSelectable = onPathRows.filter((r) => r.onPath && r.selectable).length;

  async function openPreview() {
    setPreviewing(true);
    setBatchError(undefined);
    const r = await req.previewBatch(live.map(parseBatchKey), profile?.vendor?.email);
    setPreviewing(false);
    if ("error" in r) {
      setBatchError(r.error);
      return;
    }
    setPreview(r.preview);
    setPreviewTo(r.preview.to ?? profile?.vendor?.email ?? "");
  }
  async function confirmBatch() {
    if (!preview || !looksLikeEmail(previewTo)) return;
    const r = await req.createBatch(live.map(parseBatchKey), preview, previewTo.trim());
    if (!r) return; // 実行中の二重押し
    if ("error" in r) {
      setBatchError(r.error);
      return;
    }
    setPreview(undefined);
    setSelected([]);
    setBatchError(undefined);
    setToast("送信箱にまとめ依頼を積みました。本文は下の送信箱の「本文をコピー」から");
    setTimeout(() => setToast(undefined), 6000);
    outboxRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

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
      <h2>
        ベンダーへの確認依頼
        <InfoButton title="確認依頼の仕組み">
          <p>
            未確認の項目を、保守ベンダーなどに 1
            問ずつ聞くための依頼のメールを作ります。同じベンダーに聞く項目は、最大 10 問まで選んで 1
            通のメールにまとめることもできます（「まとめて確認する」）。聞くのは選択式の 1
            問だけで、選択肢には番号を付けます。ベンダーには、メールに返信して当てはまる番号とお名前を書いてもらいます。
          </p>
          <p>
            返信が届いたら、送信箱の「返信を入力する」で、同じ番号を選び、返信に書かれていた名前と受け取った日時を入れて
            「この回答で判定を更新する」を押します。押したときだけ判定に反映され、根拠はベンダー回答として、
            誰が答え、いつ受け取り、誰が入力したかを記録します。間違えたときは「回答を取り消す」で元に戻せます。
          </p>
          <p>
            カルテはサーバに送らず、会社名・対象の名前・質問だけを渡します。依頼文は Claude
            が整えることがありますが、質問の内容と選択肢はプログラムの質問表から決めています。
          </p>
          <p>
            一覧の先頭には、いまの攻撃の経路で問われている項目を置きます。答えると結論が変わりやすい順です。
          </p>
          <p>
            まとめて確認では、選んだ項目の質問を 1
            通にまとめ、送る前に宛先と本文をプレビューで確認します。メールの文面はテンプレートだけで作り、Claude
            は使いません。本文には、攻撃の手法の ID や判定の材料は載せません。
          </p>
        </InfoButton>
      </h2>
      {req.error && <p className="err small">{req.error}</p>}
      {pending.length === 0 ? (
        <p className="muted" style={{ marginTop: 8 }}>
          未確認の項目はありません。
        </p>
      ) : (
        <div style={{ marginTop: 6 }}>
          {onPathCount > 0 && (
            <p className="muted small">
              先頭の {onPathCount} 件は、いまの攻撃の経路で問われている項目です。
            </p>
          )}
          {batchUi && (
            <div className="batch-bar">
              {onPathSelectable > 0 && (
                <button
                  type="button"
                  className="btn ghost sm"
                  onClick={() => setSelected(selectOnPath(onPathRows))}
                >
                  この攻撃の経路で問われている項目だけ選ぶ
                </button>
              )}
              {live.length > 0 && (
                <button type="button" className="btn ghost sm" onClick={() => setSelected([])}>
                  選択を外す
                </button>
              )}
              {live.length > 0 && (
                <button
                  type="button"
                  className="btn sm primary"
                  disabled={previewing || req.batchBusy}
                  onClick={() => void openPreview()}
                >
                  {previewing ? "文面を作成中…" : `選んだ ${live.length} 件をまとめて確認する`}
                </button>
              )}
              {atMax && (
                <span className="muted small">まとめられるのは {MAX_BATCH_ITEMS} 問までです。</span>
              )}
            </div>
          )}
          {batchError && <p className="err small">{batchError}</p>}
          {preview && (
            <BatchPreview
              preview={preview}
              vendorName={profile.vendor?.name}
              to={previewTo}
              onTo={setPreviewTo}
              busy={req.batchBusy}
              error={batchError}
              onConfirm={() => void confirmBatch()}
              onCancel={() => setPreview(undefined)}
            />
          )}
          {pending.map((x) => {
            const open = openFor(x.assetId, x.mitigation);
            const key = `${x.assetId}:${x.mitigation}`;
            const checked = live.includes(key);
            return (
              <div className="req-row" key={key}>
                {batchUi && (
                  <input
                    type="checkbox"
                    className="batch-check"
                    checked={checked}
                    disabled={Boolean(open) || (!checked && atMax)}
                    title={
                      open
                        ? "依頼済みです"
                        : !checked && atMax
                          ? `まとめられるのは ${MAX_BATCH_ITEMS} 問までです`
                          : "まとめて確認する項目に入れる"
                    }
                    aria-label={`${x.asset}　${mit(x.mitigation)}をまとめて確認する項目に入れる`}
                    onChange={() => setSelected(toggleSelected(live, key))}
                  />
                )}
                <div className="what">
                  <b>
                    {x.asset}　{mit(x.mitigation)}（<code>{x.mitigation}</code>）
                  </b>
                  {x.onPath && (
                    <span className="chip on-path">
                      この攻撃の経路{x.stageJa ? `：${x.stageJa}` : ""}
                    </span>
                  )}
                  {x.noteJa && <span className="muted">{x.noteJa}</span>}
                </div>
                {open ? (
                  <OutboxLink assetId={x.assetId} mitigation={x.mitigation} />
                ) : (
                  <button
                    type="button"
                    className={`btn sm ${x.onPath ? "primary" : ""}`}
                    disabled={req.busyKey !== undefined}
                    onClick={() => void createAndShow(x.assetId, x.mitigation)}
                  >
                    {req.busyKey === key ? "依頼文を作成中…" : "ベンダーに確認する"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
      <div ref={outboxRef} data-outbox-box id={isDemoMode() ? undefined : "staff-outbox"}>
        <OutboxPanel
          items={req.items}
          batches={batchUi ? req.batches : []}
          onReply={req.reply}
          onRetract={req.retract}
          onReplyBatch={req.replyBatch}
          onDeleteBatch={req.deleteBatch}
          onClear={() => void requestsApi.clear(profile?.id).then(() => req.refresh())}
        />
      </div>
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
