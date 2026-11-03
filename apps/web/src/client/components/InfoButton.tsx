/**
 * 情報ボタン（i）：画面の文字を最小限にし、仕組みや注意の説明は押したときだけ見せる。
 *
 * 使い方：
 *   <InfoButton title="外部確認とは">
 *     <p>所有を確認したドメインについて、…です。</p>
 *   </InfoButton>
 *
 * 子要素は段落（<p>）で書く。箇条書きではなく、です・ます調の丁寧な文章にする（開発者の方針）。
 * 押すと小さな吹き出しが開き、もう一度押す・外を押す・Esc で閉じる。
 */
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { useFitInViewport } from "../hooks/useFitInViewport.ts";

type Props = {
  /** 吹き出しの見出し。ボタンの読み上げ名にも使う */
  title: string;
  /** 吹き出しの本文（段落で書く） */
  children: ReactNode;
  /** 吹き出しを開く向き。既定は右下 */
  align?: "start" | "end";
};

export function InfoButton({ title, children, align = "start" }: Props) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLSpanElement>(null);
  const pop = useRef<HTMLElement>(null);
  // 吹き出しは必ず画面内に収める（左右にはみ出す分だけずらす）
  useFitInViewport(pop, open);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span className={`info ${align === "end" ? "info-end" : ""}`} ref={root}>
      <button
        type="button"
        className="info-btn"
        aria-label={`${title}の説明`}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
      >
        i
      </button>
      {open && (
        <section className="info-pop" id={id} aria-label={title} ref={pop}>
          <div className="info-title">{title}</div>
          <div className="info-body">{children}</div>
        </section>
      )}
    </span>
  );
}
