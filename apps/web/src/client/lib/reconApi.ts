/** 外部確認の API クライアント（/api/recon）。参照するのは DNS と証明書の公開ログだけ。対象ホストには接続しない */
import type {
  AppliedView,
  RunView,
  StatusView,
  TokenView,
  VerifyView,
} from "../../shared/recon.ts";
import { ApiError } from "./api.ts";
import type { CompanyProfile } from "./types.ts";

export type {
  AnswerHints,
  AssetHint,
  Evidence,
  Finding,
  InferredAnswerKey,
  ReconResult,
} from "@uchidai/recon";
export { FIXTURE_DOMAIN } from "../../shared/recon.ts";
export type { AppliedView, RunView, StatusView, TokenView, VerifyView };

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

export const reconApi = {
  token: (domain: string, renew = false) =>
    post<TokenView>("/api/recon/token", { domain, ...(renew ? { renew } : {}) }),
  verify: (domain: string) => post<VerifyView>("/api/recon/verify", { domain }),
  run: (domain: string, profile?: CompanyProfile) =>
    post<RunView>("/api/recon/run", { domain, ...(profile ? { profile } : {}) }),
  apply: (domain: string, profile: CompanyProfile) =>
    post<AppliedView>("/api/recon/apply", { domain, profile }),
  status: (domain: string) =>
    call<StatusView>(`/api/recon/status?domain=${encodeURIComponent(domain)}`),
};
