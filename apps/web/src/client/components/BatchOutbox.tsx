/**
 * 送信箱のまとめ依頼：1 通のメールとして 1 件に並べ、その中に質問ごとの状態（回答待ち／回答あり）を出す。
 * 返信は、質問ごとに番号を選び、回答者名と受領日時は 1 回だけ入れる。一部の質問だけ回答が来たときは、来た分だけ入力できる。
 * 質問ごとの回答の取り消しと、まとめ依頼ごとの削除ができる。
 */
import { type FormEvent, useState } from "react";
import type { BatchReplyRequest, BatchView, RequestView } from "../../shared/requests.ts";
import { batchProgress, composeBatchReply } from "../lib/batchSelect.ts";
import { STATUS_WORD, toLocalInput, VIA_LABEL, when } from "../lib/outbox-format.ts";
import { staffName } from "../lib/profile.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { CopyTextButton } from "./CopyTextButton.tsx";
import { InfoButton } from "./InfoButton.tsx";
import "./requests.css";

type Handlers = {
  onReplyBatch(batchId: string, body: BatchReplyRequest): Promise<string | undefined>;
  onRetract(requestId: string): Promise<string | undefined>;
  onDeleteBatch(batchId: string): Promise<string | undefined>;
};

/** 返信の入力欄。番号は本文の番号と同じ（質問ごとに、質問表の並び順で 1 から） */
export function BatchReplyForm({
  batch,
  pending,
  onReplyBatch,
}: { batch: BatchView; pending: RequestView[] } & Pick<Handlers, "onReplyBatch">) {
  const [picks, setPicks] = useState<Record<string, string | undefined>>({});
  const [repliedBy, setRepliedBy] = useState("");
  const [receivedAt, setReceivedAt] = useState(() => toLocalInput(new Date()));
  const [enteredBy, setEnteredBy] = useState(() => staffName.load());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const picked = pending.filter((c) => picks[c.id]).length;
  const ready = picked > 0 && repliedBy.trim() !== "" && receivedAt !== "";

  async function submit(e: FormEvent) {
    e.preventDefault();
    const r = composeBatchReply({
      picks,
      order: pending.map((c) => c.id),
      repliedBy,
      receivedAt,
      enteredBy,
    });
    if ("error" in r) {
      setError(r.error);
      return;
    }
    setBusy(true);
    setError(undefined);
    staffName.save(enteredBy.trim());
    const err = await onReplyBatch(batch.id, r.body);
    setBusy(false);
    if (err) setError(err);
    else setPicks({});
  }

  const total = batch.childIds.length;
  return (
    <form className="reply-form" onSubmit={(e) => void submit(e)}>
      {pending.map((c) => {
        const k = batch.childIds.indexOf(c.id) + 1;
        return (
          <fieldset key={c.id}>
            <legend>
              質問 {k}／{total}　{c.assetLabel}
            </legend>
            <p className="muted small">{c.question.textJa}</p>
            {c.question.choices.map((ch, i) => (
              <label className="reply-choice" key={ch.id}>
                <input
                  type="radio"
                  name={`batchreply-${c.id}`}
                  checked={picks[c.id] === ch.id}
                  onChange={() => setPicks((p) => ({ ...p, [c.id]: ch.id }))}
                />
                <b className="num">{i + 1}</b>
                <span>{ch.labelJa}</span>
              </label>
            ))}
          </fieldset>
        );
      })}
      <label className="reply-field">
        <span>ご回答者の名前（返信に書かれていた名前）</span>
        <input
          className="in"
          value={repliedBy}
          maxLength={80}
          placeholder="例：山田"
          onChange={(e) => setRepliedBy(e.target.value)}
        />
      </label>
      <div className="reply-pair">
        <label className="reply-field">
          <span>返信を受け取った日時</span>
          <input
            className="in"
            type="datetime-local"
            value={receivedAt}
            onChange={(e) => setReceivedAt(e.target.value)}
          />
        </label>
        <label className="reply-field">
          <span>入力する人（あなた）</span>
          <input
            className="in"
            value={enteredBy}
            maxLength={80}
            onChange={(e) => setEnteredBy(e.target.value)}
          />
        </label>
      </div>
      {error && <p className="err small">{error}</p>}
      <button type="submit" className="btn sm primary" disabled={!ready || busy}>
        {busy ? "反映しています…" : `選んだ ${picked} 問の回答で判定を更新する`}
      </button>
    </form>
  );
}

function QuestionRow({
  child,
  k,
  total,
  onRetract,
}: { child: RequestView; k: number; total: number } & Pick<Handlers, "onRetract">) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string>();
  const a = child.answer;
  async function retract() {
    setConfirming(false);
    setError(await onRetract(child.id));
  }
  return (
    <li className="batch-q" data-outbox-key={`${child.assetId}:${child.mitigation}`}>
      <span className="batch-q-head">
        <b>
          質問 {k}／{total}
        </b>
        　{child.assetLabel}　{child.background.mitigationLabelJa}
      </span>
      {a ? (
        <span className={`answered ${a.input.status === "present" ? "ok" : ""}`}>
          <span className="st green">回答あり</span> 「{a.choiceLabelJa}」→
          {STATUS_WORD[a.input.status]}
          {child.answeredBy && <>　{child.answeredBy} さん</>}
          {child.answeredAt ? `（${when(child.answeredAt)} 受領）` : ""}
          {child.enteredBy && <span className="entered">入力：{child.enteredBy}</span>}
          <span className="entered">
            <button type="button" className="btn ghost sm" onClick={() => setConfirming(true)}>
              回答を取り消す
            </button>
          </span>
          {error && <span className="err small entered">{error}</span>}
          <ConfirmDialog
            open={confirming}
            title="この質問の回答を取り消しますか？"
            confirmLabel="取り消す"
            onConfirm={() => void retract()}
            onCancel={() => setConfirming(false)}
          >
            <p>
              この質問だけが「回答待ち」に戻り、判定も回答を入れる前の状態に戻ります。ほかの質問の回答はそのままです。
            </p>
          </ConfirmDialog>
        </span>
      ) : (
        <span className="st amber">回答待ち</span>
      )}
    </li>
  );
}

export function BatchItem({
  batch,
  questions: children,
  onReplyBatch,
  onRetract,
  onDeleteBatch,
}: { batch: BatchView; questions: RequestView[] } & Handlers) {
  const [replyOpen, setReplyOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string>();
  const progress = batchProgress(children);
  const pending = children.filter((c) => !c.answer);
  const answered = children.length - pending.length;

  async function remove() {
    setDeleting(false);
    setError(await onDeleteBatch(batch.id));
  }

  return (
    <div className="mail batch-mail" data-batch-id={batch.id}>
      <div className="hd">
        <span className={`st ${progress === "answered" ? "green" : "amber"}`}>
          {progress === "answered"
            ? "すべて回答あり"
            : progress === "partial"
              ? `一部回答あり（${answered}／${children.length}）`
              : "回答待ち"}
        </span>
        <span className="chip">まとめて {children.length} 問</span>
        <span>{VIA_LABEL[batch.sentVia]}</span>
        {batch.sentAt && <span>送信 {when(batch.sentAt)}</span>}
        <span>作成 {when(batch.createdAt)}</span>
        {batch.to && <span className="batch-dest">宛先：{batch.to}</span>}
      </div>
      {batch.sendError && <p className="err small">{batch.sendError}</p>}
      <p className="subj">{batch.subject}</p>
      <p className="row" style={{ marginTop: 8, gap: 8 }}>
        <CopyTextButton text={batch.text} />
        <a className="btn sm" href={batch.mailtoUrl}>
          メールソフトで開く
        </a>
        <InfoButton title="送り方について">
          <p>
            まとめ依頼のメールは長いので、メールソフトによっては「メールソフトで開く」で本文が途中で切れることがあります。質問が欠けると、返信の番号と質問の対応がずれてしまうので、通常は「本文をコピー」を押して、お使いのメールソフトに貼って送ってください。
          </p>
          <p>
            返信が届いたら、質問ごとに同じ番号を選んで入力します。回答者の名前と受け取った日時は 1
            回だけです。一部の質問にしか答えが来ていないときは、来た分だけ入力できます。
          </p>
        </InfoButton>
      </p>
      <ol className="batch-qs">
        {children.map((c, i) => (
          <QuestionRow
            key={c.id}
            child={c}
            k={i + 1}
            total={children.length}
            onRetract={onRetract}
          />
        ))}
      </ol>
      <details>
        <summary>本文を見る</summary>
        <pre>{batch.text}</pre>
      </details>
      {pending.length > 0 && (
        <details
          className="reply"
          open={replyOpen}
          onToggle={(e) => setReplyOpen(e.currentTarget.open)}
        >
          <summary>返信を入力する（残り {pending.length} 問）</summary>
          {replyOpen && (
            <BatchReplyForm batch={batch} pending={pending} onReplyBatch={onReplyBatch} />
          )}
        </details>
      )}
      <p style={{ marginTop: 8 }}>
        <button type="button" className="btn ghost sm" onClick={() => setDeleting(true)}>
          このまとめ依頼を削除
        </button>
        {error && <span className="err small"> {error}</span>}
      </p>
      <ConfirmDialog
        open={deleting}
        title="まとめ依頼を削除しますか？"
        confirmLabel="削除する"
        onConfirm={() => void remove()}
        onCancel={() => setDeleting(false)}
      >
        <p>
          送信箱からこの依頼と全部の質問が消えます。入力済みの回答は取り消され、判定も回答を入れる前の状態に戻ります。元に戻すことはできません。
        </p>
      </ConfirmDialog>
    </div>
  );
}
