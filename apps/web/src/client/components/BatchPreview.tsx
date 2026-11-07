/**
 * まとめて確認のプレビュー：宛先を目立たせ、メールの件名と本文をそのまま見せる。
 * 宛先が未設定（または形が違う）なら「送信箱に積む」を押せない。ここで見た本文が、そのまま送信箱に積まれる。
 */
import type { BatchPreviewView } from "../../shared/requests.ts";
import { looksLikeEmail } from "../lib/batchSelect.ts";
import { InfoButton } from "./InfoButton.tsx";

export function BatchPreview({
  preview,
  vendorName,
  to,
  onTo,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  preview: BatchPreviewView;
  vendorName?: string | undefined;
  to: string;
  onTo(v: string): void;
  busy: boolean;
  error?: string | undefined;
  onConfirm(): void;
  onCancel(): void;
}) {
  const valid = looksLikeEmail(to);
  return (
    <section className="batch-preview" aria-label="まとめ依頼のプレビュー">
      <h3>
        送る前の確認
        <InfoButton title="この確認について">
          <p>
            ここに出ている宛先と本文が、そのまま送信箱に積まれます。宛先を間違えると、会社の弱点の候補がほかの人に届いてしまうので、宛先を必ずご確認ください。
          </p>
          <p>
            メールは 1 通にまとめます。SMTP
            を設定していないときは、送信箱に積むだけで、実際には送りません。積んだあとで「本文をコピー」から、お使いのメールソフトに貼って送れます。
          </p>
        </InfoButton>
      </h3>
      <div className={`batch-to ${valid ? "ok" : "ng"}`}>
        <label>
          <span className="batch-to-label">宛先{vendorName ? `（${vendorName}）` : ""}</span>
          <input
            className="in"
            type="email"
            inputMode="email"
            value={to}
            maxLength={200}
            placeholder="vendor@example.com"
            onChange={(e) => onTo(e.target.value)}
          />
        </label>
        {!valid && (
          <p className="err small">
            宛先がありません。1 件のメールアドレスを入れるまで、積めません。
          </p>
        )}
      </div>
      <p className="muted small">{preview.items.length} 問をまとめて聞きます。</p>
      <p className="subj">{preview.subject}</p>
      <pre>{preview.text}</pre>
      {error && <p className="err small">{error}</p>}
      <p className="row" style={{ marginTop: 8, gap: 8 }}>
        <button
          type="button"
          className="btn sm primary"
          disabled={!valid || busy}
          onClick={onConfirm}
        >
          {busy ? "積んでいます…" : "送信箱に積む"}
        </button>
        <button type="button" className="btn ghost sm" disabled={busy} onClick={onCancel}>
          やめる
        </button>
      </p>
    </section>
  );
}
