/**
 * サーバが記事を読めるか（GET /api/health の readAvailable）。
 * 分かるまでは、前回キー無しと分かっていれば false、それ以外は undefined（不明）を返す。
 * 不明のうちは「読める」ものとして扱い、読めなければサーバの 503 で分かる
 */
import { useEffect, useState } from "react";
import { api } from "../lib/api.ts";
import { readUnavailable } from "../lib/read-available.ts";

export function useReadAvailable(): boolean | undefined {
  const [available, setAvailable] = useState<boolean | undefined>(() =>
    readUnavailable.load() ? false : undefined,
  );
  useEffect(() => {
    let alive = true;
    api
      .health()
      .then((h) => {
        if (h.readAvailable) readUnavailable.clear();
        else readUnavailable.save();
        if (alive) setAvailable(h.readAvailable);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return available;
}
