/**
 * 確認依頼の状態：送信箱の一覧と SSE の購読（アプリ全体で 1 本）。
 * ベンダーの返信メールを担当者が入力する（reply）と、useApp の answers に加え、/api/evaluate が再実行される
 * （黄 → 赤に変わり、再生が巻き戻る）。取り消す（retract）と answers から外れ、判定も元に戻る。
 * SSE は別のタブの画面を合わせるためのもの（同じタブの入力は自分で反映し、届いた通知は二重に適用しない）。
 * 画面を開き直しても回答が消えないよう、起動時に回答済みの依頼を同じカルテのぶんだけ適用する。
 * デモモード（?demo=1）では前回の実演の回答を再適用しない（毎回同じ映像にする）。
 */
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { AnswerEvent, ReplyRequest, RequestView } from "../../shared/requests.ts";
import { isDemoMode } from "../demo/params.ts";
import { requestsApi } from "../lib/requestsApi.ts";
import { useApp } from "./useApp.tsx";

export type RequestsState = {
  /** いまのカルテの依頼（新しい順） */
  items: RequestView[];
  busyKey: string | undefined;
  error: string | undefined;
  /** 直近に届いた回答（画面で知らせる） */
  lastAnswer: AnswerEvent | undefined;
  create(assetId: string, mitigation: string): Promise<RequestView | undefined>;
  /** ベンダーの返信の内容を入力し、判定に反映する。失敗したら理由の文を返す（成功は undefined） */
  reply(requestId: string, body: ReplyRequest): Promise<string | undefined>;
  /** 入力した回答を取り消し、判定を元に戻す。失敗したら理由の文を返す */
  retract(requestId: string): Promise<string | undefined>;
  refresh(): Promise<void>;
};

const Ctx = createContext<RequestsState | undefined>(undefined);

export function RequestsProvider({ children }: { children: ReactNode }) {
  const app = useApp();
  const { profile, addAnswer, removeAnswer } = app;
  const [items, setItems] = useState<RequestView[]>([]);
  const [busyKey, setBusyKey] = useState<string>();
  const [error, setError] = useState<string>();
  const [lastAnswer, setLastAnswer] = useState<AnswerEvent>();
  const applied = useRef(new Set<string>());
  /** 適用済みの記録が対応するカルテ（オブジェクト）。useApp.setProfile は新しいオブジェクトを作り answers を空にする */
  const appliedFor = useRef<unknown>(undefined);
  const profileId = profile?.id;
  const replayOld = !isDemoMode();

  const refresh = useCallback(async () => {
    try {
      const { items: xs } = await requestsApi.list();
      setItems(xs);
      setError(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : "送信箱を読めません");
    }
  }, []);

  // 回答済みの依頼（同じカルテ）を一度だけ適用する（デモモードでは前回の回答を引きずらない）。
  // カルテが置き換わったら（同じ ID でも。useApp.setProfile は answers を空にする）、適用済みの記録も忘れる
  useEffect(() => {
    if (appliedFor.current !== profile) {
      appliedFor.current = profile;
      applied.current = new Set();
    }
    if (!profile || !replayOld) return;
    for (const it of items) {
      if (!it.answer || it.profileId !== profile.id || applied.current.has(it.id)) continue;
      applied.current.add(it.id);
      addAnswer(it.answer.input);
    }
  }, [items, profile, addAnswer, replayOld]);

  useEffect(() => {
    void refresh();
    const unsub = requestsApi.subscribe({
      answer: (ev) => {
        setLastAnswer(ev);
        if (ev.profileId === profileId && !applied.current.has(ev.requestId)) {
          applied.current.add(ev.requestId);
          addAnswer(ev.answer);
        }
        void refresh();
      },
      retract: (ev) => {
        if (ev.profileId === profileId && applied.current.delete(ev.requestId))
          removeAnswer(ev.assetId, ev.mitigation);
        void refresh();
      },
    });
    return unsub;
  }, [refresh, profileId, addAnswer, removeAnswer]);

  const reply = useCallback(
    async (requestId: string, body: ReplyRequest) => {
      try {
        const r = await requestsApi.reply(requestId, body);
        const it = items.find((x) => x.id === requestId);
        // 同じカルテの依頼だけ判定に反映する（SSE の通知が先に来ていたら二重にしない）
        if (it?.profileId === profileId && !applied.current.has(requestId)) {
          applied.current.add(requestId);
          addAnswer(r.answer);
        }
        // 一覧を読み直す前に手元の一覧も更新する（古い一覧のまま回答を二重に適用しないため）
        const updated = r.request;
        if (updated) setItems((xs) => xs.map((x) => (x.id === requestId ? updated : x)));
        await refresh();
        return undefined;
      } catch (e) {
        return e instanceof Error ? e.message : "回答を入力できませんでした";
      }
    },
    [items, profileId, addAnswer, refresh],
  );

  const retract = useCallback(
    async (requestId: string) => {
      try {
        const { retracted } = await requestsApi.retract(requestId);
        if (retracted.profileId === profileId) {
          applied.current.delete(requestId);
          removeAnswer(retracted.assetId, retracted.mitigation);
        }
        setItems((xs) =>
          xs.map((x) => {
            if (x.id !== requestId) return x;
            const {
              answer: _a,
              answeredAt: _b,
              answeredBy: _c,
              enteredBy: _d,
              enteredAt: _e,
              ...rest
            } = x;
            return rest;
          }),
        );
        await refresh();
        return undefined;
      } catch (e) {
        return e instanceof Error ? e.message : "回答を取り消せませんでした";
      }
    },
    [profileId, removeAnswer, refresh],
  );

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

  // 画面に出すのは、いまのカルテの依頼だけ（別の会社の依頼を「依頼済み」と見せない）。
  // 保存形式が古く profileId の無い依頼は、どのカルテにも出す
  const visible = useMemo(
    () => items.filter((it) => !it.profileId || it.profileId === profileId),
    [items, profileId],
  );
  const value = useMemo<RequestsState>(
    () => ({ items: visible, busyKey, error, lastAnswer, create, reply, retract, refresh }),
    [visible, busyKey, error, lastAnswer, create, reply, retract, refresh],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRequests(): RequestsState {
  const v = useContext(Ctx);
  if (!v) throw new Error("RequestsProvider の外で useRequests が呼ばれた");
  return v;
}
