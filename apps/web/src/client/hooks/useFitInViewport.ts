/**
 * 吹き出し（情報ボタン、チップの一覧）を必ずブラウザの画面内に収める。
 * 開いた直後に位置を測り、左右にはみ出す分だけ横にずらす。窓の大きさが変わっても追従する。
 */
import { type RefObject, useLayoutEffect, useState } from "react";

const MARGIN = 8;

export function useFitInViewport(ref: RefObject<HTMLElement | null>, open: boolean): number {
  const [shift, setShift] = useState(0);
  useLayoutEffect(() => {
    if (!open) {
      setShift(0);
      return;
    }
    const measure = () => {
      const el = ref.current;
      if (!el) return;
      // いまのずらし量を除いた素の位置で測る
      el.style.transform = "";
      const r = el.getBoundingClientRect();
      const vw = document.documentElement.clientWidth;
      let dx = 0;
      if (r.left < MARGIN) dx = MARGIN - r.left;
      else if (r.right > vw - MARGIN) dx = vw - MARGIN - r.right;
      if (r.width > vw - MARGIN * 2) dx = MARGIN - r.left;
      el.style.transform = dx ? `translateX(${dx}px)` : "";
      setShift(dx);
    };
    measure();
    addEventListener("resize", measure);
    return () => removeEventListener("resize", measure);
  }, [ref, open]);
  return shift;
}
