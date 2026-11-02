/**
 * 外部確認の結果の型（zod で定義）。S3 の API はこの型をそのまま返してよい。
 *
 * 参照するのは DNS の公開レコードと証明書の公開ログ（CT）だけ。対象ホストへは一切アクセスしない。
 * 「推定」はすべてプログラムの固定表（patterns.ts）で決め、根拠のレコード値を evidence に添える。
 */
import { z } from "zod";

/** ホスト名（2 ラベル以上、英数字とハイフン、末尾のドットなし）。小文字に正規化してから検証する */
export const Hostname = z
  .string()
  .min(3)
  .max(253)
  .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/);
export type Hostname = z.infer<typeof Hostname>;

/** 応答の出どころ：実際の参照か、記録した応答（fixture）の再生か */
export const SourceKind = z.enum(["live", "fixture"]);
export type SourceKind = z.infer<typeof SourceKind>;

/** 根拠。何のレコードのどの値からそう判断したかを、そのまま見せられる形で持つ */
export const Evidence = z.object({
  kind: z.enum(["dns", "ct"]),
  /** DNS のレコード種別（TXT、MX、A、AAAA、CNAME、PTR）または CT の "certificate" */
  recordType: z.string(),
  /** 問い合わせた名前（ホスト名、または CT の対象ドメイン） */
  name: z.string(),
  value: z.string(),
});
export type Evidence = z.infer<typeof Evidence>;

/** 所有確認の結果（TXT レコード `uchidai-verify=<token>` を確認した記録） */
export const OwnershipProof = z.object({
  domain: Hostname,
  record: z.string(),
  verifiedAt: z.string(),
  source: SourceKind,
});
export type OwnershipProof = z.infer<typeof OwnershipProof>;

/** 証明書の公開ログの 1 件（crt.sh の応答を正規化した形。fixture もこの形で持つ） */
export const CtCertificate = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  issuer: z.string(),
  /** 証明書に載っている名前（CN と SAN。小文字） */
  names: z.array(z.string()),
  notBefore: z.string(),
  notAfter: z.string(),
});
export type CtCertificate = z.infer<typeof CtCertificate>;

export const HostnameEntry = z.object({
  name: z.string(),
  /** ワイルドカード証明書の名前（*.example.jp）か */
  wildcard: z.boolean(),
  sources: z.array(z.enum(["ct", "dns"])),
  certCount: z.number().int().nonnegative(),
  /** 確認時点で有効期限内の証明書の数 */
  activeCertCount: z.number().int().nonnegative(),
  firstIssued: z.string().optional(),
  lastExpiry: z.string().optional(),
  /** DNS で名前が解決できたか。null は未確認（ワイルドカード、件数上限） */
  resolves: z.boolean().nullable(),
  addresses: z.array(z.string()),
});
export type HostnameEntry = z.infer<typeof HostnameEntry>;

export const RemoteAccessKind = z.enum(["vpn", "rdp"]);
export type RemoteAccessKind = z.infer<typeof RemoteAccessKind>;

/** 社外からの入口（VPN、リモートデスクトップ）用と推定されるホスト名 */
export const RemoteAccessCandidate = z.object({
  hostname: z.string(),
  kind: RemoteAccessKind,
  /** 当たったパターンの名前（patterns.ts） */
  pattern: z.string(),
  reasonJa: z.string(),
  evidence: z.array(Evidence),
  /** IPA 事例集の脆弱性事例の番号 */
  ipaCases: z.array(z.number().int()),
});
export type RemoteAccessCandidate = z.infer<typeof RemoteAccessCandidate>;

export const SpfInfo = z.object({
  present: z.boolean(),
  record: z.string().optional(),
  includes: z.array(z.string()),
  allMechanism: z.enum(["-all", "~all", "?all", "+all"]).optional(),
  evidence: z.array(Evidence),
});
export const DmarcInfo = z.object({
  present: z.boolean(),
  record: z.string().optional(),
  policy: z.enum(["none", "quarantine", "reject"]).optional(),
  subdomainPolicy: z.enum(["none", "quarantine", "reject"]).optional(),
  evidence: z.array(Evidence),
});
export type SpfInfo = z.infer<typeof SpfInfo>;
export type DmarcInfo = z.infer<typeof DmarcInfo>;

/** 提供元の推定。断定はしない（手がかりと根拠を見せる） */
export const ProviderGuess = z.object({
  name: z.string().optional(),
  /** 5 問の hosting の値に対応する分類 */
  kind: z.enum(["cloud", "provider", "onprem", "unknown"]),
  reasonJa: z.string(),
  evidence: z.array(Evidence),
});
export type ProviderGuess = z.infer<typeof ProviderGuess>;

export const MxRecord = z.object({ exchange: z.string(), priority: z.number().int() });
export type MxRecord = z.infer<typeof MxRecord>;

export const MailInfo = z.object({
  mx: z.array(MxRecord),
  spf: SpfInfo,
  dmarc: DmarcInfo,
  provider: ProviderGuess,
});
export type MailInfo = z.infer<typeof MailInfo>;

/** SPF の include などから分かる、使っているクラウドサービス */
export const CloudService = z.object({
  name: z.string(),
  via: z.enum(["spf_include", "mx", "cname"]),
  evidence: z.array(Evidence),
});
export type CloudService = z.infer<typeof CloudService>;

export const WebInfo = z.object({
  /** 確認した名前（ドメインそのものと www） */
  hostnames: z.array(z.string()),
  records: z.array(Evidence),
  hosting: ProviderGuess,
});
export type WebInfo = z.infer<typeof WebInfo>;

export const FindingCategory = z.enum([
  "hostnames",
  "remote_access",
  "mail_auth",
  "mail_provider",
  "cloud_services",
  "web_hosting",
]);
export const FindingSeverity = z.enum(["ok", "info", "warn"]);

/** 画面に出す確認項目の 1 行。根拠のレコード値と IPA 脆弱性事例の番号を添える */
export const Finding = z.object({
  id: z.string(),
  category: FindingCategory,
  severity: FindingSeverity,
  titleJa: z.string(),
  detailJa: z.string(),
  evidence: z.array(Evidence),
  ipaCases: z.array(z.number().int()),
  /** 出典の表記（IPA 事例集など） */
  sourceJa: z.string().optional(),
});
export type FindingCategory = z.infer<typeof FindingCategory>;
export type FindingSeverity = z.infer<typeof FindingSeverity>;
export type Finding = z.infer<typeof Finding>;

export const ReconResult = z.object({
  domain: Hostname,
  checkedAt: z.string(),
  sources: z.object({
    dns: SourceKind,
    ct: z.enum(["live", "fixture", "unavailable"]),
  }),
  ownership: OwnershipProof,
  hostnames: z.array(HostnameEntry),
  remoteAccessCandidates: z.array(RemoteAccessCandidate),
  mail: MailInfo,
  cloudServices: z.array(CloudService),
  web: WebInfo,
  findings: z.array(Finding),
  /** 参照できなかった項目などの注記 */
  notesJa: z.array(z.string()),
});
export type ReconResult = z.infer<typeof ReconResult>;

/** ドメインの正規化：小文字、末尾のドットを除く。不正なら例外 */
export function normalizeDomain(input: string): Hostname {
  const lowered = input.trim().toLowerCase().replace(/\.$/, "");
  return Hostname.parse(lowered);
}
