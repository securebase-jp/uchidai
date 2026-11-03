/**
 * チップ型の選択メニュー：上部バーの「会社」「事例」に使う。
 * 押すと情報ボタン（i）と同じ見た目の吹き出しが開き、中の項目を選ぶ。
 * もう一度押す・外を押す・Esc で閉じる。↑↓ で項目を移動し、Enter／Space で選ぶ。aria-expanded を持つ
 */
import { type ReactNode, useEffect, useId, useRef, useState } from "react";

export type ChipMenuItem = {
  key: string;
  /** 項目の文字（最小限にする） */
  labelJa: string;
  /** いま選ばれている項目か */
  current?: boolean;
  /** 項目の右に小さく出す印（「架空」など） */
  mark?: string;
  onPick(): void;
};

type Props = {
  /** チップに出す文字 */
  label: ReactNode;
  /** 読み上げ名と吹き出しの見出し */
  title: string;
  items: ChipMenuItem[];
  /** 吹き出しの見出しの下に出す一文（いま選んでいる事例の全文など） */
  note?: string;
  /** 項目が無いときの一文 */
  emptyJa?: string;
  /** チップの付加クラス（空のときの強調など） */
  className?: string;
};

export function ChipMenu({ label, title, items, note, emptyJa, className }: Props) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    // 開いたら最初の項目（いま選んでいるものがあればそれ）に焦点を移す
    const options = list.current?.querySelectorAll<HTMLButtonElement>("[role=option]");
    const first = options ? [...options].find((o) => o.ariaSelected === "true") : undefined;
    (first ?? options?.[0])?.focus();
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const onListKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const options = [...(list.current?.querySelectorAll<HTMLButtonElement>("[role=option]") ?? [])];
    if (options.length === 0) return;
    const i = options.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      e.key === "ArrowDown" ? (i + 1) % options.length : (i - 1 + options.length) % options.length;
    options[next]?.focus();
    e.preventDefault();
  };

  return (
    <span className="chip-menu" ref={root}>
      <button
        type="button"
        ref={button}
        className={`chip chip-btn ${open ? "open" : ""} ${className ?? ""}`}
        aria-label={title}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
      </button>
      {open && (
        <div className="info-pop chip-menu-pop" id={id}>
          <div className="info-title">{title}</div>
          {note && <p className="chip-menu-note">{note}</p>}
          <div
            className="chip-menu-list"
            role="listbox"
            aria-label={title}
            ref={list}
            onKeyDown={onListKey}
          >
            {items.map((it) => (
              <button
                type="button"
                key={it.key}
                role="option"
                aria-selected={it.current ?? false}
                className={`chip-menu-item ${it.current ? "current" : ""}`}
                onClick={() => {
                  setOpen(false);
                  it.onPick();
                }}
              >
                <span className="chip-menu-text">{it.labelJa}</span>
                {it.mark && <small className="chip-mark">{it.mark}</small>}
              </button>
            ))}
            {items.length === 0 && emptyJa && <p className="muted small">{emptyJa}</p>}
          </div>
        </div>
      )}
    </span>
  );
}
