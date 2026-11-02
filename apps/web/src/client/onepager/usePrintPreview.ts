/**
 * 一枚の印刷体裁を画面で確かめる切り替え。
 * - 「印刷の見え方を確認」：<html> に print-preview を付け、印刷と同じ規則（onepager.css の :root:is(.printing, .print-preview)）を当てる
 * - 実際の印刷：beforeprint で printing を付け、afterprint で外す（規則を @media print に二重に書かない）
 * 印刷プレビューを開けない環境（ヘッドレスなど）でも、同じ切り替えで見た目を撮れる
 */
import { useCallback, useEffect, useState } from "react";

const PREVIEW = "print-preview";
const PRINTING = "printing";

export function usePrintPreview(): { preview: boolean; toggle(): void } {
  const [preview, setPreview] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle(PREVIEW, preview);
    return () => root.classList.remove(PREVIEW);
  }, [preview]);

  useEffect(() => {
    const root = document.documentElement;
    const on = () => root.classList.add(PRINTING);
    const off = () => root.classList.remove(PRINTING);
    window.addEventListener("beforeprint", on);
    window.addEventListener("afterprint", off);
    // beforeprint を出さないブラウザ向けの保険（印刷用メディアへの切り替えを拾う）
    const mq = typeof matchMedia === "function" ? matchMedia("print") : undefined;
    const onChange = (e: MediaQueryListEvent) => (e.matches ? on() : off());
    mq?.addEventListener("change", onChange);
    return () => {
      window.removeEventListener("beforeprint", on);
      window.removeEventListener("afterprint", off);
      mq?.removeEventListener("change", onChange);
      off();
    };
  }, []);

  const toggle = useCallback(() => setPreview((p) => !p), []);
  return { preview, toggle };
}
