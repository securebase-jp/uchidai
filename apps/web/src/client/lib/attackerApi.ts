/** AI攻撃者と知見なし比較の API 呼び出し（キーはサーバにしかない） */
import { ApiError } from "./api.ts";
import type { AttackPath, Case, CompanyProfile, Verdict } from "./types.ts";

export type AiPathCandidate = {
  titleJa?: string;
  steps: { role: string; technique: string; reasonJa: string }[];
};
export type DiscardedCandidate = {
  titleJa?: string;
  stage: "safety" | "schema" | "validation";
  reasons: string[];
  steps: { role: string; technique: string }[];
};
export type ReconMeta = {
  model?: string;
  recordedAt?: string;
  note?: string;
  attempts?: number;
  attackerVersion?: string;
  unavailable?: string;
};
export type ReconResponse = {
  paths: AttackPath[];
  discarded: DiscardedCandidate[];
  candidates: AiPathCandidate[];
  log: string[];
  recorded: boolean;
  meta: ReconMeta;
};

export type GenericMitigationItem = {
  mitigationId?: string;
  rejectedId?: string;
  nameJa: string;
  reasonJa: string;
};
export type ComparedMitigation = {
  mitigation?: string;
  labelJa?: string;
  nameJa: string;
  reasonJa: string;
  stageLabelJa?: string;
  verdictReasonJa?: string;
};
export type Comparison = {
  effective: ComparedMitigation[];
  ineffective: ComparedMitigation[];
  outside: ComparedMitigation[];
  unmapped: ComparedMitigation[];
  counts: {
    total: number;
    effective: number;
    ineffective: number;
    outside: number;
    unmapped: number;
  };
};
export type CompareResponse = {
  comparison: Comparison;
  items: GenericMitigationItem[];
  recorded: boolean;
  meta: { model?: string; recordedAt?: string; note?: string };
};

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? `API エラー（${res.status}）`);
  return data as T;
}

export const attackerApi = {
  /** 下見（対策ボタン・回答を適用済みのカルテを渡す） */
  recon: (profile: CompanyProfile, replay = false) =>
    post<ReconResponse>("/api/attacker/recon", { profile, ...(replay ? { replay: true } : {}) }),
  /** 候補を現在のカルテで検証し直す（Claude は呼ばない） */
  validate: (profile: CompanyProfile, candidates: AiPathCandidate[]) =>
    post<{ paths: AttackPath[]; discarded: DiscardedCandidate[] }>("/api/attacker/validate", {
      profile,
      candidates,
    }),
  /** 知見なしの対策一覧を取り寄せて振り分ける。items を渡せば振り分けだけ（Claude は呼ばない） */
  compare: (body: {
    caseId?: string;
    case?: Case;
    verdict: Verdict;
    items?: GenericMitigationItem[];
  }) => post<CompareResponse>("/api/attacker/compare", body),
};
