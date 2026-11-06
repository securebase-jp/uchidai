/**
 * 外部確認の API（/api/recon）の契約。画面とサーバの両方が読む（値として recon や engine を import しない）。
 */
import type { CompanyProfile, Contradiction, ProfileAnswers } from "@uchidai/engine";
import type { AnswerHints, AssetHint, InferredAnswerKey, ReconResult } from "@uchidai/recon";
import { z } from "zod";

/** 架空のドメイン。記録した応答（fixture）を再生し、実ネットワークには出ない */
export const FIXTURE_DOMAIN = "demo-seiko.example";

/** ドメインの入力（英数字・ハイフン・ドット。国際化ドメイン名は xn-- の形で）。正規化は recon の normalizeDomain */
export const DomainInput = z
  .string()
  .trim()
  .min(3, "ドメインが短すぎます")
  .max(253, "ドメインが長すぎます")
  .regex(
    /^[A-Za-z0-9.-]+$/,
    "ドメインは英数字・ハイフン・ドットだけで入力してください（国際化ドメイン名は xn-- の形）",
  );

export const TokenRequest = z.object({ domain: DomainInput, renew: z.boolean().optional() });
export const DomainRequest = z.object({ domain: DomainInput });

export type TokenView = {
  domain: string;
  fixture: boolean;
  token: string;
  createdAt: string;
  /** 期限（7 日。架空のドメインには無い） */
  expiresAt?: string;
  /** DNS に追加する TXT レコード */
  record: { name: string; type: "TXT"; value: string };
  instructionsJa: string[];
};

export type VerifyView =
  | { ok: true; domain: string; fixture: boolean; verifiedAt: string; expiresAt: string }
  | { ok: false; domain: string; fixture: boolean; reasonJa: string; txtRecords: string[] };

/** カルテへの反映（findContradictions → applyAssetHints → mergeAnswers の結果） */
export type AppliedView = {
  /** 反映後のカルテ（domain と domainVerified も入る） */
  profile: CompanyProfile;
  /** 反映前のカルテと外部確認の食い違い（可能性） */
  contradictions: Contradiction[];
  /** 5 問の回答があるときの、推定値を重ねた結果 */
  answers?: { merged: ProfileAnswers; applied: InferredAnswerKey[] };
};

export type RunView = {
  domain: string;
  fixture: boolean;
  result: ReconResult;
  answersHints: AnswerHints;
  assetHints: AssetHint[];
  /** crt.sh を参照できなかったときの注記 */
  ctUnavailableJa?: string;
  /** profile を渡したときだけ */
  applied?: AppliedView;
};

export type StatusView = {
  domain: string;
  fixture: boolean;
  token: {
    createdAt: string;
    expiresAt?: string;
    expired?: boolean;
    record: { name: string; type: "TXT"; value: string };
  } | null;
  verified: { verifiedAt: string; expiresAt: string } | null;
  lastRun: { checkedAt: string; findings: number; ctUnavailable: boolean } | null;
};

export const CT_UNAVAILABLE_JA = "CT ログは今回取得できませんでした。DNS の結果だけで続けます";
