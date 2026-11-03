/**
 * 「記事を貼る…」の小さな入力の吹き出し（URL／本文／PDF）。事例の選択（上部バーのチップ、事例が空の画面の一覧）から
 * その場で開く。サーバに Claude API のキーが無いときは、入力欄の代わりに読めない理由を出す。
 * 吹き出しは useFitInViewport で必ず画面内に収める。外を押す・Esc で閉じる
 */
import { type RefObject, useEffect, useRef } from "react";
import { useFitInViewport } from "../hooks/useFitInViewport.ts";
import { useReadAvailable } from "../hooks/useReadAvailable.ts";
import { ArticleInput } from "./ArticleInput.tsx";

type Props = {
  onClose(): void;
  /** 外を押しても閉じない範囲（開くボタンを含む枠）。無ければ吹き出しの外すべて */
  boundary?: RefObject<HTMLElement | null>;
  /** 位置の基準の違い：チップの段（上部バー）か、画面内の一覧か */
  placement?: "topbar" | "inline";
};

export function ArticleBubble({ onClose, boundary, placement = "inline" }: Props) {
  const pop = useRef<HTMLDivElement>(null);
  const readAvailable = useReadAvailable();
  useFitInViewport(pop, true);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const inside = (boundary?.current ?? pop.current)?.contains(e.target as Node);
      if (!inside) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [boundary, onClose]);

  return (
    <div
      className={`info-pop article-pop ${placement === "topbar" ? "chip-menu-pop" : ""}`}
      role="dialog"
      aria-label="記事を貼る"
      ref={pop}
    >
      <div className="info-title">記事を貼る</div>
      {readAvailable === false ? (
        <p className="chip-menu-note" role="status">
          このサーバには Claude API
          のキーが無いので、記事は読めません。記録済みの事例から選んでください。
        </p>
      ) : (
        <ArticleInput onDone={onClose} />
      )}
    </div>
  );
}
