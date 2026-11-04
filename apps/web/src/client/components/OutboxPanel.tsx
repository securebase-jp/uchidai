/**
 * 送信箱：依頼ごとに宛先・件名・本文・「メールソフトで開く」。
 * ベンダーはメールの返信で番号を答えるので、返信が届いたら担当者がここで「返信を入力する」。
 * 入力すると判定に反映され、誰が（ベンダー側）・いつ受け取り・誰が入力したかが残る。間違えたら「回答を取り消す」。
 */
import { type FormEvent, useState } from "react";
import type { ReplyRequest, RequestView } from "../../shared/requests.ts";
import { staffName } from "../lib/profile.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import "./requests.css";

const VIA_LABEL: Record<RequestView["sentVia"], string> = {
  outbox: "送信箱（未送信）",
  mailto: "メールソフトで送る",
  smtp: "SMTP で送信済み",
};

const STATUS_WORD = { present: "「ある」", absent: "「ない」", unknown: "「不明」" } as const;

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString("ja-JP", {
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}

/** <input type="datetime-local"> の値（手元の時刻）にする */
function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 返信の入力欄。番号はメール本文の番号と同じ（質問表の並び順で 1 から） */
function ReplyForm({
  item,
  onReply,
}: {
  item: RequestView;
  onReply(requestId: string, body: ReplyRequest): Promise<string | undefined>;
}) {
  const [choice, setChoice] = useState<string>();
  const [repliedBy, setRepliedBy] = useState("");
  // 開いた時点の時刻を既定にする（変えられる）
  const [receivedAt, setReceivedAt] = useState(() => toLocalInput(new Date()));
  const [enteredBy, setEnteredBy] = useState(() => staffName.load());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const name = `reply-${item.id}`;
  const ready = choice !== undefined && repliedBy.trim() !== "" && receivedAt !== "";

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!choice || !ready) return;
    const received = new Date(receivedAt);
    if (Number.isNaN(received.getTime())) {
      setError("返信を受け取った日時を入れてください");
      return;
    }
    setBusy(true);
    setError(undefined);
    staffName.save(enteredBy.trim());
    const err = await onReply(item.id, {
      choice,
      repliedBy: repliedBy.trim(),
      receivedAt: received.toISOString(),
      ...(enteredBy.trim() ? { enteredBy: enteredBy.trim() } : {}),
    });
    setBusy(false);
    if (err) setError(err);
  }

  return (
    <form className="reply-form" onSubmit={(e) => void submit(e)}>
      <fieldset>
        <legend>返信に書かれていた番号</legend>
        {item.question.choices.map((c, i) => (
          <label className="reply-choice" key={c.id}>
            <input
              type="radio"
              name={name}
              checked={choice === c.id}
              onChange={() => setChoice(c.id)}
            />
            <b className="num">{i + 1}</b>
            <span>{c.labelJa}</span>
          </label>
        ))}
      </fieldset>
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
        {busy ? "反映しています…" : "この回答で判定を更新する"}
      </button>
    </form>
  );
}

export function OutboxItem({
  item,
  onReply,
  onRetract,
}: {
  item: RequestView;
  onReply(requestId: string, body: ReplyRequest): Promise<string | undefined>;
  onRetract(requestId: string): Promise<string | undefined>;
}) {
  const [replyOpen, setReplyOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string>();

  async function retract() {
    setConfirming(false);
    setError(await onRetract(item.id));
  }

  return (
    <div className="mail">
      <div className="hd">
        <span
          className={`st ${item.answer ? (item.answer.input.status === "present" ? "green" : item.answer.input.status === "absent" ? "red" : "amber") : "amber"}`}
        >
          {item.answer ? "回答あり" : "回答待ち"}
        </span>
        <span>{VIA_LABEL[item.sentVia]}</span>
        {item.sentAt && <span>送信 {when(item.sentAt)}</span>}
        <span>作成 {when(item.createdAt)}</span>
        <span>文面：{item.writer === "claude" ? "Claude" : "テンプレート"}</span>
        {item.to && <span>宛先：{item.to}</span>}
      </div>
      {item.sendError && <p className="err small">{item.sendError}</p>}
      <p className="subj">{item.subject}</p>
      <p className="muted" style={{ marginTop: 4 }}>
        {item.assetLabel}　{item.background.mitigationLabelJa}（
        <code>{item.background.mitigationId}</code>）
        {item.background.techniqueId && (
          <>
            　手法 <code>{item.background.techniqueId}</code>
          </>
        )}
      </p>
      <p className="row" style={{ marginTop: 8, gap: 8 }}>
        <a className="btn sm primary" href={item.mailtoUrl}>
          メールソフトで開く
        </a>
      </p>
      <details>
        <summary>本文を見る</summary>
        <pre>{item.text}</pre>
      </details>
      {item.answer ? (
        <div className={`answered ${item.answer.input.status === "present" ? "ok" : ""}`}>
          <b>{item.answeredBy}</b> さんの返信
          {item.answeredAt ? `（${when(item.answeredAt)} 受領）` : ""}： 「
          {item.answer.choiceLabelJa}」 → {item.assetLabel}の {item.background.mitigationLabelJa} は
          {STATUS_WORD[item.answer.input.status]}
          （根拠：ベンダー回答）
          {item.enteredBy && (
            <span className="entered">
              入力：{item.enteredBy}
              {item.enteredAt ? `　${when(item.enteredAt)}` : ""}
            </span>
          )}
          <span className="entered">
            <button type="button" className="btn ghost sm" onClick={() => setConfirming(true)}>
              回答を取り消す
            </button>
          </span>
          {error && <span className="err small entered">{error}</span>}
          <ConfirmDialog
            open={confirming}
            title="回答を取り消しますか？"
            confirmLabel="取り消す"
            onConfirm={() => void retract()}
            onCancel={() => setConfirming(false)}
          >
            <p>
              この依頼は「回答待ち」に戻り、判定も回答を入れる前の状態に戻ります。返信の内容は、もう一度入力し直せます。
            </p>
          </ConfirmDialog>
        </div>
      ) : (
        <details
          className="reply"
          open={replyOpen}
          onToggle={(e) => setReplyOpen(e.currentTarget.open)}
        >
          <summary>返信を入力する</summary>
          {replyOpen && <ReplyForm item={item} onReply={onReply} />}
        </details>
      )}
    </div>
  );
}

export function OutboxPanel({
  items,
  onReply,
  onRetract,
  onClear,
}: {
  items: RequestView[];
  onReply(requestId: string, body: ReplyRequest): Promise<string | undefined>;
  onRetract(requestId: string): Promise<string | undefined>;
  /** 送信箱を空にする（録画前などに使う） */
  onClear?: () => void;
}) {
  return (
    <div className="outbox">
      <h2 style={{ marginBottom: 0 }}>送信箱</h2>
      {onClear && items.length > 0 && (
        <button type="button" className="btn ghost sm" style={{ marginTop: 6 }} onClick={onClear}>
          送信箱を空にする（{items.length} 件）
        </button>
      )}
      {items.length === 0 ? (
        <p className="muted" style={{ marginTop: 6 }}>
          まだ依頼はありません。上の「ベンダーに確認する」で作ると、ここに依頼のメール文ができます。
        </p>
      ) : (
        items.map((it) => (
          <OutboxItem key={it.id} item={it} onReply={onReply} onRetract={onRetract} />
        ))
      )}
    </div>
  );
}
