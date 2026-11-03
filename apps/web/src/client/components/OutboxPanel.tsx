/** 送信箱：依頼ごとに宛先・件名・本文・回答リンク・「メールソフトで開く」、回答が来れば誰がいつ何と答えたか */
import type { RequestView } from "../../shared/requests.ts";
import "./requests.css";

const VIA_LABEL: Record<RequestView["sentVia"], string> = {
  outbox: "送信箱（未送信）",
  mailto: "メールソフトで送る",
  smtp: "SMTP で送信済み",
};

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

export function OutboxItem({ item }: { item: RequestView }) {
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
        <a className="btn sm" href={item.answerUrl} target="_blank" rel="noreferrer">
          回答ページを開く
        </a>
      </p>
      <p className="link muted" style={{ marginTop: 6 }}>
        回答リンク：{item.answerUrl}
      </p>
      <details>
        <summary>本文を見る</summary>
        <pre>{item.text}</pre>
      </details>
      {item.answer && (
        <div className={`answered ${item.answer.input.status === "present" ? "ok" : ""}`}>
          <b>{item.answeredBy}</b> が {item.answeredAt ? when(item.answeredAt) : ""} に回答： 「
          {item.answer.choiceLabelJa}」 → {item.assetLabel}の {item.background.mitigationLabelJa} は
          {item.answer.input.status === "present"
            ? "「ある」"
            : item.answer.input.status === "absent"
              ? "「ない」"
              : "「不明」"}
          （根拠：ベンダー回答）
        </div>
      )}
    </div>
  );
}

export function OutboxPanel({
  items,
  live,
  onClear,
}: {
  items: RequestView[];
  live: boolean;
  /** 送信箱を空にする（録画前などに使う） */
  onClear?: () => void;
}) {
  return (
    <div className="outbox">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 style={{ marginBottom: 0 }}>送信箱</h2>
        <span className={`live ${live ? "on" : ""}`} title="回答の受信（SSE）">
          <i /> {live ? "回答を待ち受け中" : "受信を再接続中"}
        </span>
      </div>
      {onClear && items.length > 0 && (
        <button type="button" className="btn ghost sm" style={{ marginTop: 6 }} onClick={onClear}>
          送信箱を空にする（{items.length} 件）
        </button>
      )}
      {items.length === 0 ? (
        <p className="muted" style={{ marginTop: 6 }}>
          まだ依頼はありません。上の「ベンダーに確認する」で作ると、ここに文面と回答リンクが出ます。
        </p>
      ) : (
        items.map((it) => <OutboxItem key={it.id} item={it} />)
      )}
    </div>
  );
}
