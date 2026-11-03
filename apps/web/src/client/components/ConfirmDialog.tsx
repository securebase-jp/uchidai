/**
 * 確認のポップアップ（消してはいけないものを消す前に必ずはさむ）。
 * - ネイティブの <dialog>（showModal）なので、背面は操作できず、Esc で閉じ、焦点は中に閉じ込められる。背景のクリックでは閉じない
 * - 既定の焦点は「やめる」。誤クリックや Enter の連打では実行されない
 * - 説明は段落（です・ます調）で、何が消えるか・元に戻せないかを書く
 */
import { type ReactNode, useEffect, useId, useRef } from "react";

type Props = {
  open: boolean;
  /** 見出し（「カルテをリセットしますか？」など） */
  title: string;
  /** 本文（段落で書く） */
  children: ReactNode;
  /** 実行ボタンの文言（「リセットする」） */
  confirmLabel: string;
  onConfirm(): void;
  onCancel(): void;
};

export function ConfirmDialog({ open, title, children, confirmLabel, onConfirm, onCancel }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      cancelRef.current?.focus();
    }
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="confirm-dialog"
      aria-labelledby={titleId}
      // Esc（cancel イベント）は「やめる」。背景のクリックでは閉じない（誤クリックで意図せず動かないように）
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
    >
      {open && (
        <div className="confirm-body">
          <h2 id={titleId}>{title}</h2>
          <div className="confirm-text">{children}</div>
          <div className="confirm-actions">
            <button type="button" className="btn" ref={cancelRef} onClick={onCancel}>
              やめる
            </button>
            <button type="button" className="btn danger" onClick={onConfirm}>
              {confirmLabel}
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
