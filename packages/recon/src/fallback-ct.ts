/**
 * crt.sh を先に使い、結果が空か使えないときだけ予備の検索先（Cert Spotter）を使う CT の参照。
 * crt.sh が 1 件以上返したときは、予備には問い合わせない。
 * 宛先の検査をやめる経路ではない：どちらも restrictedFetch 経由の実装を渡して組み立てる。
 */
import { CtUnavailableError } from "./crtsh.ts";
import { ForbiddenDestinationError } from "./safe-fetch.ts";
import type { CtLogSource, CtRunInfo } from "./sources.ts";
import { type CtCertificate, normalizeDomain } from "./types.ts";

export interface FallbackCtOptions {
  /** 先に使う検索先（crt.sh） */
  primary: CtLogSource;
  /** primary が空か使えないときだけ使う検索先（Cert Spotter） */
  secondary: CtLogSource;
}

/** 使えなかった理由。宛先の検査に落ちたのはプログラムの誤りなので、使えない扱いにせず投げ直す */
function failureReason(error: unknown): string {
  if (error instanceof ForbiddenDestinationError) throw error;
  return error instanceof Error ? error.message : String(error);
}

export class FallbackCtSource implements CtLogSource {
  private readonly primary: CtLogSource;
  private readonly secondary: CtLogSource;
  private readonly runs = new Map<string, CtRunInfo>();

  constructor(options: FallbackCtOptions) {
    this.primary = options.primary;
    this.secondary = options.secondary;
  }

  lastRun(domain: string): CtRunInfo | undefined {
    return this.runs.get(normalizeDomain(domain));
  }

  async listCertificates(domain: string): Promise<CtCertificate[]> {
    const normalized = normalizeDomain(domain);
    this.runs.delete(normalized);

    let primaryFailure: string | undefined;
    try {
      const certs = await this.primary.listCertificates(normalized);
      if (certs.length > 0) {
        this.runs.set(normalized, {
          provider: "crtsh",
          notesJa: this.primary.lastRun?.(normalized)?.notesJa ?? [],
        });
        return certs;
      }
    } catch (error) {
      primaryFailure = failureReason(error);
    }

    // crt.sh が空、または使えなかった。ここで初めて予備を使う
    try {
      const certs = await this.secondary.listCertificates(normalized);
      const secondaryNotes = this.secondary.lastRun?.(normalized)?.notesJa ?? [];
      if (primaryFailure === undefined && certs.length === 0) {
        // どちらも空。crt.sh は応答したので、その結果として返す
        this.runs.set(normalized, { provider: "crtsh", notesJa: secondaryNotes });
        return certs;
      }
      this.runs.set(normalized, {
        provider: "certspotter",
        notesJa: [
          primaryFailure === undefined
            ? "crt.sh に載っていなかったため、証明書の公開ログは Cert Spotter から取得した"
            : `crt.sh を参照できなかったため、証明書の公開ログは Cert Spotter から取得した（crt.sh: ${primaryFailure}）`,
          ...secondaryNotes,
        ],
      });
      return certs;
    } catch (error) {
      const secondaryFailure = failureReason(error);
      if (primaryFailure === undefined) {
        // crt.sh は空を返し、予備は使えなかった。空の結果のまま続け、予備が使えなかったことを注記する
        this.runs.set(normalized, {
          provider: "crtsh",
          notesJa: [
            `crt.sh は 0 件で、予備の Cert Spotter も参照できなかった: ${secondaryFailure}`,
          ],
        });
        return [];
      }
      throw new CtUnavailableError(
        `crt.sh: ${primaryFailure} ／ Cert Spotter: ${secondaryFailure}`,
      );
    }
  }
}
