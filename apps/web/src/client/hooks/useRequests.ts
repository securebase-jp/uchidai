/**
 * 確認依頼の状態：送信箱の一覧と SSE の購読。
 * 回答が届いたら useApp の answers に加え、/api/evaluate が再実行される（黄 → 赤に変わり、再生が巻き戻る）。
 * 画面を開き直しても回答が消えないよう、起動時に回答済みの依頼を同じカルテのぶんだけ適用する。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { AnswerEvent, RequestView } from "../../shared/requests.ts";
import { requestsApi } from "../lib/requestsApi.ts";
import { useApp } from "./useApp.tsx";

export type RequestsState = {
  items: RequestView[];
  live: boolean;
  busyKey: string | undefined;
  error: string | undefined;
  /** 直近に届いた回答（画面で知らせる） */
  lastAnswer: AnswerEvent | undefined;
  create(assetId: string, mitigation: string): Promise<RequestView | undefined>;
  refresh(): Promise<void>;
};

export function useRequests(): RequestsState {
  const app = useApp();
  const { profile, addAnswer } = app;
  const [items, setItems] = useState<RequestView[]>([]);
  const [live, setLive] = useState(false);
  const [busyKey, setBusyKey] = useState<string>();
  const [error, setError] = useState<string>();
  const [lastAnswer, setLastAnswer] = useState<AnswerEvent>();
  const applied = useRef(new Set<string>());
  const profileId = profile?.id;

  const refresh = useCallback(async () => {
    try {
      const { items: xs } = await requestsApi.list();
      setItems(xs);
      setError(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : "送信箱を読めません");
    }
  }, []);

  // 回答済みの依頼（同じカルテ）を一度だけ適用する
  useEffect(() => {
    if (!profileId) return;
    for (const it of items) {
      if (!it.answer || it.profileId !== profileId || applied.current.has(it.id)) continue;
      applied.current.add(it.id);
      addAnswer(it.answer.input);
    }
  }, [items, profileId, addAnswer]);

  useEffect(() => {
    void refresh();
    const unsub = requestsApi.subscribe(
      (ev) => {
        setLastAnswer(ev);
        if (ev.profileId === profileId && !applied.current.has(ev.requestId)) {
          applied.current.add(ev.requestId);
          addAnswer(ev.answer);
        }
        void refresh();
      },
      (open) => setLive(open),
    );
    return unsub;
  }, [refresh, profileId, addAnswer]);

  const create = useCallback(
    async (assetId: string, mitigation: string) => {
      if (!profile) return undefined;
      const key = `${assetId}:${mitigation}`;
      setBusyKey(key);
      try {
        const { request } = await requestsApi.create(profile, assetId, mitigation);
        setItems((xs) => [request, ...xs]);
        setError(undefined);
        return request;
      } catch (e) {
        setError(e instanceof Error ? e.message : "依頼を作れませんでした");
        return undefined;
      } finally {
        setBusyKey(undefined);
      }
    },
    [profile],
  );

  return { items, live, busyKey, error, lastAnswer, create, refresh };
}
