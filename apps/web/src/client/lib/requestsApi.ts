/** 確認依頼と回答の API クライアント（S7）。カルテは抜粋だけ送る */
import type { AnswerInput } from "../../shared/api.ts";
import type {
  AnswerEvent,
  AnswerPageView,
  MeasureDraftView,
  RequestView,
} from "../../shared/requests.ts";
import { ApiError } from "./api.ts";
import type { CompanyProfile } from "./types.ts";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, body.error ?? `API エラー（${res.status}）`);
  return body as T;
}
const post = <T>(path: string, body: unknown) =>
  call<T>(path, { method: "POST", body: JSON.stringify(body) });

/** サーバに送るのは会社名、ベンダー、資産の id・role・label だけ */
export function excerpt(p: CompanyProfile) {
  return {
    id: p.id,
    companyName: p.companyName,
    ...(p.vendor ? { vendor: p.vendor } : {}),
    assets: p.assets.map((a) => ({ id: a.id, role: a.role, label: a.label })),
  };
}

export const requestsApi = {
  list: () => call<{ items: RequestView[] }>("/api/requests"),
  /** 送信箱を空にする */
  clear: () => call<{ ok: true; cleared: number }>("/api/requests", { method: "DELETE" }),
  create: (profile: CompanyProfile, assetId: string, mitigation: string) =>
    post<{ request: RequestView; writerNoteJa?: string }>("/api/requests", {
      profile: excerpt(profile),
      assetId,
      mitigation,
    }),
  page: (token: string) => call<AnswerPageView>(`/api/requests/${encodeURIComponent(token)}`),
  answer: (token: string, choice: string, answeredBy: string) =>
    post<{ ok: true; answer: AnswerInput; choiceLabelJa: string }>(
      `/api/requests/${encodeURIComponent(token)}/answer`,
      { choice, answeredBy },
    ),
  measureDraft: (profile: CompanyProfile, measureId: string) =>
    post<MeasureDraftView>("/api/requests/measure-draft", {
      profile: excerpt(profile),
      measureId,
    }),
  /** SSE を購読する。返り値で解除 */
  subscribe: (onAnswer: (ev: AnswerEvent) => void, onState?: (open: boolean) => void) => {
    const es = new EventSource("/api/requests/events");
    es.addEventListener("answer", (e) => {
      try {
        onAnswer(JSON.parse((e as MessageEvent).data) as AnswerEvent);
      } catch {
        // 壊れたイベントは無視する
      }
    });
    es.onopen = () => onState?.(true);
    es.onerror = () => onState?.(false);
    return () => es.close();
  },
};
