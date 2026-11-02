/** 画面の設定：黒背景／明るい背景、動きを減らす（prefers-reduced-motion も尊重） */
import { useCallback, useEffect, useState } from "react";
import { storage } from "../lib/storage.ts";

export type Settings = {
  theme: "dark" | "light";
  reduced: boolean;
  toggleTheme(): void;
  setReduced(v: boolean): void;
};

const systemReduced = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export function useSettings(): Settings {
  const [theme, setTheme] = useState<"dark" | "light">(() => storage.theme() ?? "dark");
  const [reduced, setReducedState] = useState<boolean>(
    () => storage.reduceMotion() ?? systemReduced(),
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useEffect(() => {
    document.documentElement.dataset.reduced = reduced ? "true" : "false";
  }, [reduced]);

  const toggleTheme = useCallback(() => {
    setTheme((t) => {
      const next = t === "dark" ? "light" : "dark";
      storage.setTheme(next);
      return next;
    });
  }, []);
  const setReduced = useCallback((v: boolean) => {
    storage.setReduceMotion(v);
    setReducedState(v);
  }, []);
  return { theme, reduced, toggleTheme, setReduced };
}
