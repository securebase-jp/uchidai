/**
 * 参照先の抽象化。実装は (a) Node の dns/promises と crt.sh、(b) fixture（記録した応答の再生）。
 * どの実装も、存在しない名前（NXDOMAIN）やレコードなし（NODATA）は空配列で返し、例外にしない。
 */
import type { CtCertificate, MxRecord } from "./types.ts";

export interface DnsResolver {
  /** TXT レコード。分割された文字列は連結して 1 レコード 1 要素にする */
  resolveTxt(name: string): Promise<string[]>;
  resolveMx(name: string): Promise<MxRecord[]>;
  resolve4(name: string): Promise<string[]>;
  resolve6(name: string): Promise<string[]>;
  resolveCname(name: string): Promise<string[]>;
  /** 逆引き（PTR）。レンタルサーバ事業者の手がかりに使う。実装しなくてもよい */
  resolvePtr?(ip: string): Promise<string[]>;
}

export interface CtLogSource {
  /** ドメインとそのサブドメインに発行された証明書を公開ログから列挙する */
  listCertificates(domain: string): Promise<CtCertificate[]>;
}

/** 応答のキャッシュ（crt.sh の負荷を抑えるため必須。既定はディスク） */
export interface ReconCache {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
}

export interface ReconSources {
  resolver: DnsResolver;
  ct: CtLogSource;
}
