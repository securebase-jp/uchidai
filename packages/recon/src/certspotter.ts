/**
 * crt.sh が空か失敗のときの予備として、証明書の公開ログの検索サービス Cert Spotter（SSLMate）の
 * 発行記録 API を使う。認証なし・API キーなし。取得は restrictedFetch 経由だけ
 * （URL は `/v1/issuances?domain=<domain>&include_subdomains=true&expand=dns_names&expand=issuer` に固定）。
 * 応答はキャッシュに保存し、同じドメインへの問い合わせを繰り返さない。
 *
 * 認証なしの枠は、ドメイン全体（include_subdomains=true）の問い合わせで 1 時間 10 回。
 * 超えると 429 が返るので、DNS だけで続けて、しばらくして再実行してもらう。
 * ページングは追わない（Link ヘッダも見ない）。1 ページに収まらないドメインは取れた分だけで続け、注記する。
 */
import { z } from "zod";
import { FileCache } from "./cache.ts";
import { CtUnavailableError, toIsoUtc } from "./crtsh.ts";
import type { FetchLike } from "./proxy.ts";
import { certspotterUrl, ForbiddenDestinationError, restrictedFetch } from "./safe-fetch.ts";
import type { CtLogSource, CtRunInfo, ReconCache } from "./sources.ts";
import { CtCertificate, normalizeDomain } from "./types.ts";

/** Cert Spotter の応答の 1 件（使う項目だけ） */
export const CertSpotterIssuance = z.object({
  id: z.union([z.number(), z.string()]).optional(),
  dns_names: z.array(z.string()),
  issuer: z
    .object({
      friendly_name: z.string().optional(),
      name: z.string().optional(),
    })
    .optional(),
  not_before: z.string(),
  not_after: z.string(),
  /** 失効しているか。確認できないときは null */
  revoked: z.boolean().nullable().optional(),
});
export type CertSpotterIssuance = z.infer<typeof CertSpotterIssuance>;

/** 1 ページの件数（既定）。これだけ返ってきたら、続きがあるかもしれない */
export const CERTSPOTTER_PAGE_SIZE = 100;

/** 1 件を正規化する。失効済みと、対象ドメインの外の名前だけの記録は捨てる */
export function normalizeIssuance(
  row: CertSpotterIssuance,
  domain: string,
): CtCertificate | undefined {
  if (row.revoked === true) return undefined;
  const suffix = `.${domain}`;
  const names = [
    ...new Set(
      row.dns_names
        .map((n) => n.trim().toLowerCase())
        .filter((n) => n.length > 0 && (n === domain || n.endsWith(suffix))),
    ),
  ].sort();
  if (names.length === 0) return undefined;
  return {
    ...(row.id === undefined ? {} : { id: row.id }),
    issuer: row.issuer?.friendly_name ?? row.issuer?.name ?? "",
    names,
    notBefore: toIsoUtc(row.not_before),
    notAfter: toIsoUtc(row.not_after),
  };
}

const CachedResult = z.object({
  certificates: z.array(CtCertificate),
  partial: z.boolean(),
});

export interface CertSpotterOptions {
  fetch?: FetchLike;
  cache?: ReconCache;
  timeoutMs?: number;
}

export class CertSpotterSource implements CtLogSource {
  private readonly cache: ReconCache;
  private readonly fetchImpl: FetchLike | undefined;
  private readonly timeoutMs: number | undefined;
  private readonly runs = new Map<string, CtRunInfo>();

  constructor(options: CertSpotterOptions = {}) {
    this.cache = options.cache ?? new FileCache();
    this.fetchImpl = options.fetch;
    this.timeoutMs = options.timeoutMs;
  }

  lastRun(domain: string): CtRunInfo | undefined {
    return this.runs.get(normalizeDomain(domain));
  }

  async listCertificates(domain: string): Promise<CtCertificate[]> {
    const normalized = normalizeDomain(domain);
    const key = `certspotter:${normalized}`;
    const cached = await this.cache.get(key);
    if (cached !== undefined) {
      const hit = CachedResult.parse(JSON.parse(cached));
      this.remember(normalized, hit.partial);
      return hit.certificates;
    }

    let response: Response;
    try {
      response = await restrictedFetch(certspotterUrl(normalized), {
        ...(this.fetchImpl ? { fetch: this.fetchImpl } : {}),
        ...(this.timeoutMs === undefined ? {} : { timeoutMs: this.timeoutMs }),
      });
    } catch (error) {
      // 宛先の検査に落ちたのはプログラムの誤りなのでそのまま投げる。それ以外（接続できない、時間切れ）は使えない扱い
      if (error instanceof ForbiddenDestinationError) throw error;
      throw new CtUnavailableError(
        `Cert Spotter に接続できなかった（${normalized}）: ${(error as Error).message}`,
      );
    }
    if (response.status === 429) {
      throw new CtUnavailableError(
        `Cert Spotter の問い合わせ回数の上限（認証なしは、ドメイン全体の検索で 1 時間 10 回）に達した。しばらくして再実行してください（${normalized}）`,
      );
    }
    if (!response.ok) {
      throw new CtUnavailableError(`Cert Spotter が ${response.status} を返した（${normalized}）`);
    }
    const text = await response.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new CtUnavailableError(`Cert Spotter の応答を JSON として読めない（${normalized}）`);
    }
    const rows = z.array(CertSpotterIssuance).safeParse(parsed);
    if (!rows.success) {
      throw new CtUnavailableError(`Cert Spotter の応答が想定した形ではない（${normalized}）`);
    }
    const certificates = rows.data
      .map((row) => normalizeIssuance(row, normalized))
      .filter((c): c is CtCertificate => c !== undefined);
    const partial = rows.data.length >= CERTSPOTTER_PAGE_SIZE;
    // 0 件は保存しない（crt.sh と同じ。載るまでの遅れを 24 時間覚えてしまわないため）
    if (certificates.length > 0) {
      await this.cache.set(key, JSON.stringify({ certificates, partial }));
    }
    this.remember(normalized, partial);
    return certificates;
  }

  private remember(domain: string, partial: boolean): void {
    this.runs.set(domain, {
      provider: "certspotter",
      notesJa: partial
        ? [
            `Cert Spotter の応答が 1 ページ（${CERTSPOTTER_PAGE_SIZE} 件）に収まらなかったため、証明書は一部のみ取得した（続きは取得しない）`,
          ]
        : [],
    });
  }
}
