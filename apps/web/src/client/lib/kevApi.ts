/** 悪用確認済み脆弱性（CISA KEV）の API クライアント（/api/kev）。製品名と版はこのサーバの中だけで扱い、Claude には渡らない */
import type { KevMatchView, KevRefreshView, KevStatusView } from "../../shared/kev.ts";
import { ApiError } from "./api.ts";
import type { CompanyProfile } from "./types.ts";

export type { KevEntry, KevMatch, KevMatchedRange, KevVersionStatus } from "@uchidai/engine";
export type { KevMatchView, KevRefreshView, KevStatusView };

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

/** 状態の読み込みは資産カードごとに走るので、同時に一度だけ問い合わせて共有する */
let statusPromise: Promise<KevStatusView> | undefined;

export const kevApi = {
  status: (fresh = false) => {
    if (fresh || !statusPromise) {
      statusPromise = call<KevStatusView>("/api/kev/status").catch((e) => {
        statusPromise = undefined;
        throw e;
      });
    }
    return statusPromise;
  },
  refresh: async (force = false) => {
    const view = await post<KevRefreshView>("/api/kev/refresh", force ? { force } : {});
    statusPromise = Promise.resolve(view.status);
    return view;
  },
  match: async (profile: CompanyProfile, assetId: string, product: string, version: string) => {
    const view = await post<KevMatchView>("/api/kev/match", {
      profile,
      assetId,
      product,
      version,
    });
    statusPromise = Promise.resolve(view.status);
    return view;
  },
};

/** 版の状態の表示語と色（色だけに頼らず語も出す） */
export const KEV_STATUS_LABEL = {
  affected: "該当",
  not_affected: "該当しない",
  unknown: "未確認",
} as const;
export const KEV_STATUS_TONE = {
  affected: "red",
  not_affected: "green",
  unknown: "amber",
} as const;
