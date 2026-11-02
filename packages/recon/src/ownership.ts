/**
 * 所有確認。ドメインの TXT レコードに `uchidai-verify=<token>` があるかを DNS で確かめる。
 *
 * 他の確認（recon）は、この関数が返した VerifiedDomain を受け取らないと動かない。
 * VerifiedDomain は WeakSet で発行を記録し、外から同じ形のオブジェクトを作っても通らないようにしている。
 */
import { randomBytes } from "node:crypto";
import { NodeDnsResolver } from "./dns-node.ts";
import type { DnsResolver } from "./sources.ts";
import { type Hostname, normalizeDomain, type OwnershipProof } from "./types.ts";

export const VERIFY_PREFIX = "uchidai-verify=";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

export class OwnershipNotVerifiedError extends Error {
  readonly domain: string;
  constructor(domain: string, reason: string) {
    super(`所有確認が通っていないドメインには外部確認を実行しない（${reason}）: ${domain}`);
    this.name = "OwnershipNotVerifiedError";
    this.domain = domain;
  }
}

declare const verifiedBrand: unique symbol;
/** 所有確認に通ったことの証。verifyOwnership だけが作る */
export type VerifiedDomain = Readonly<OwnershipProof> & { readonly [verifiedBrand]: true };

const issued = new WeakSet<object>();

/** 所有確認用のトークン（32 文字の 16 進数。URL とレコード値に安全な文字だけ） */
export function generateVerificationToken(bytes = 16): string {
  return randomBytes(bytes).toString("hex");
}

/** TXT レコードに設定する値 */
export function verificationRecord(token: string): string {
  if (!TOKEN_PATTERN.test(token)) throw new Error("トークンの形式が不正");
  return `${VERIFY_PREFIX}${token}`;
}

/** 担当者に見せる手順（日本語） */
export function verificationInstructionsJa(domain: string, token: string): string[] {
  const d = normalizeDomain(domain);
  return [
    `${d} の DNS に TXT レコードを 1 件追加してください。`,
    `名前（ホスト）: ${d}（レコードの名前は「@」または空欄）`,
    `値: ${verificationRecord(token)}`,
    "反映まで数分から数時間かかることがあります。反映後に「所有を確認」を押してください。",
    "ウチダイが参照するのは DNS の公開レコードと証明書の公開ログだけで、サーバには接続しません。",
  ];
}

export type OwnershipCheck =
  | { ok: true; verified: VerifiedDomain }
  | { ok: false; domain: Hostname; reasonJa: string; txtRecords: string[] };

export interface VerifyOptions {
  resolver?: DnsResolver;
  now?: () => Date;
}

let defaultResolverFactory: () => DnsResolver = () => new NodeDnsResolver();
/** 既定の DNS 参照の実装を差し替える（テスト、fixture） */
export function setDefaultResolver(factory: () => DnsResolver): void {
  defaultResolverFactory = factory;
}
export function defaultResolver(): DnsResolver {
  return defaultResolverFactory();
}

function unquote(value: string): string {
  const t = value.trim();
  return t.length >= 2 && t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1) : t;
}

export async function verifyOwnership(
  domain: string,
  token: string,
  options: VerifyOptions = {},
): Promise<OwnershipCheck> {
  const normalized = normalizeDomain(domain);
  if (!TOKEN_PATTERN.test(token)) {
    return { ok: false, domain: normalized, reasonJa: "トークンの形式が不正", txtRecords: [] };
  }
  const resolver = options.resolver ?? defaultResolver();
  const expected = verificationRecord(token);
  const txtRecords = (await resolver.resolveTxt(normalized)).map(unquote);
  const hit = txtRecords.find((r) => r === expected);
  if (!hit) {
    const reasonJa = txtRecords.some((r) => r.startsWith(VERIFY_PREFIX))
      ? "uchidai-verify の TXT レコードはあるがトークンが一致しない"
      : "uchidai-verify の TXT レコードが見つからない";
    return { ok: false, domain: normalized, reasonJa, txtRecords };
  }
  const proof: OwnershipProof = {
    domain: normalized,
    record: hit,
    verifiedAt: (options.now ?? (() => new Date()))().toISOString(),
    source: options.resolver ? "fixture" : "live",
  };
  const verified = Object.freeze(proof) as VerifiedDomain;
  issued.add(verified);
  return { ok: true, verified };
}

/** verifyOwnership が発行した VerifiedDomain か（同じ形のオブジェクトを作っても通らない） */
export function isVerifiedDomain(value: unknown): value is VerifiedDomain {
  return typeof value === "object" && value !== null && issued.has(value);
}

/** 所有確認が通っていなければ例外。recon の入口で呼ぶ */
export function assertVerified(domain: string, proof: unknown): VerifiedDomain {
  const normalized = normalizeDomain(domain);
  if (!isVerifiedDomain(proof)) {
    throw new OwnershipNotVerifiedError(normalized, "verifyOwnership の結果がない");
  }
  if (proof.domain !== normalized) {
    throw new OwnershipNotVerifiedError(normalized, `別のドメイン（${proof.domain}）の確認結果`);
  }
  return proof;
}
