/**
 * 証明書の公開ログ（Certificate Transparency）の検索サービス crt.sh の JSON 出力を使う。
 * 取得は restrictedFetch 経由だけ（URL は crt.sh の `?q=%25.<domain>&output=json` に固定）。
 * 応答はキャッシュに保存し、同じドメインへの問い合わせを繰り返さない。
 */
import { z } from "zod";
import { FileCache } from "./cache.ts";
import type { FetchLike } from "./proxy.ts";
import { crtshUrl, restrictedFetch } from "./safe-fetch.ts";
import type { CtLogSource, ReconCache } from "./sources.ts";
import { CtCertificate, normalizeDomain } from "./types.ts";

/** crt.sh の JSON 出力の 1 行（使う項目だけ） */
export const CrtShRow = z.object({
  id: z.union([z.number(), z.string()]).optional(),
  issuer_name: z.string().default(""),
  common_name: z.string().default(""),
  /** 改行区切りの名前一覧（SAN） */
  name_value: z.string().default(""),
  not_before: z.string(),
  not_after: z.string(),
});
export type CrtShRow = z.infer<typeof CrtShRow>;

export class CtUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CtUnavailableError";
  }
}

/** crt.sh の日時はタイムゾーンなし（UTC）。ISO 8601 の UTC に揃える */
export function toIsoUtc(value: string): string {
  const trimmed = value.trim();
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(trimmed)) return trimmed;
  return `${trimmed.replace(" ", "T")}Z`;
}

/** 1 行を正規化する。対象ドメインの外の名前は捨てる */
export function normalizeRow(row: CrtShRow, domain: string): CtCertificate | undefined {
  const suffix = `.${domain}`;
  const names = [...new Set([row.common_name, ...row.name_value.split("\n")])]
    .map((n) => n.trim().toLowerCase())
    .filter((n) => n.length > 0 && (n === domain || n.endsWith(suffix)))
    .sort();
  if (names.length === 0) return undefined;
  return {
    ...(row.id === undefined ? {} : { id: row.id }),
    issuer: row.issuer_name,
    names,
    notBefore: toIsoUtc(row.not_before),
    notAfter: toIsoUtc(row.not_after),
  };
}

export interface CrtShOptions {
  fetch?: FetchLike;
  cache?: ReconCache;
  timeoutMs?: number;
}

export class CrtShSource implements CtLogSource {
  private readonly cache: ReconCache;
  private readonly fetchImpl: FetchLike | undefined;
  private readonly timeoutMs: number | undefined;

  constructor(options: CrtShOptions = {}) {
    this.cache = options.cache ?? new FileCache();
    this.fetchImpl = options.fetch;
    this.timeoutMs = options.timeoutMs;
  }

  async listCertificates(domain: string): Promise<CtCertificate[]> {
    const normalized = normalizeDomain(domain);
    const key = `crtsh:${normalized}`;
    const cached = await this.cache.get(key);
    if (cached !== undefined) return z.array(CtCertificate).parse(JSON.parse(cached));

    const response = await restrictedFetch(crtshUrl(normalized), {
      ...(this.fetchImpl ? { fetch: this.fetchImpl } : {}),
      ...(this.timeoutMs === undefined ? {} : { timeoutMs: this.timeoutMs }),
    });
    if (!response.ok) {
      throw new CtUnavailableError(`crt.sh が ${response.status} を返した（${normalized}）`);
    }
    const text = await response.text();
    let parsed: unknown;
    try {
      parsed = text.trim() === "" ? [] : JSON.parse(text);
    } catch {
      throw new CtUnavailableError(`crt.sh の応答を JSON として読めない（${normalized}）`);
    }
    const rows = z.array(CrtShRow).parse(parsed);
    const certificates = rows
      .map((row) => normalizeRow(row, normalized))
      .filter((c): c is CtCertificate => c !== undefined);
    await this.cache.set(key, JSON.stringify(certificates));
    return certificates;
  }
}
