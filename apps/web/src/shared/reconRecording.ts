/**
 * 外部確認の記録（demo/recordings/recon.demo-sec.json）の形。
 * デモの場面 4 で再生する。実際に一度だけ外部確認して得た結果を残したもので、再生はネットワークに出ない。
 * 記録するスクリプト（demo/scripts/record-recon.ts）、再生する画面（ReconReplay）、テストの 3 か所が読む。
 *
 * 画面側では recon や engine を値として import しない（型だけ）。ここは zod で形を検証するだけで、判定はしない。
 */
import type { AnswerHints, AssetHint, ReconResult } from "@uchidai/recon";
import { z } from "zod";

export const RECON_RECORDING_VERSION = 1;

/** 記録に添える注記（記録の由来と、参照したものの範囲） */
export const RECON_RECORDING_NOTE =
  "実際の外部確認の記録。DNS の公開レコードと証明書の公開ログだけを参照。対象のホストにはアクセスしていない。リクエストヘッダは保存していない";

const Evidence = z.object({
  kind: z.enum(["dns", "ct"]),
  recordType: z.string(),
  name: z.string(),
  value: z.string(),
});

const Provider = z.object({
  name: z.string().optional(),
  kind: z.enum(["cloud", "provider", "onprem", "unknown"]),
  reasonJa: z.string(),
  evidence: z.array(Evidence),
});

const Finding = z.object({
  id: z.string(),
  category: z.enum([
    "hostnames",
    "remote_access",
    "mail_auth",
    "mail_provider",
    "cloud_services",
    "web_hosting",
  ]),
  severity: z.enum(["ok", "info", "warn"]),
  titleJa: z.string(),
  detailJa: z.string(),
  evidence: z.array(Evidence),
  ipaCases: z.array(z.number().int()),
  sourceJa: z.string().optional(),
});

/** 画面が読む分だけを検証する（完全な形の検証は recon の ReconResult。記録のテストと記録時に通す） */
const Result = z.object({
  domain: z.string(),
  checkedAt: z.string(),
  sources: z.object({
    dns: z.enum(["live", "fixture"]),
    ct: z.enum(["live", "fixture", "unavailable"]),
    ctProvider: z.enum(["crtsh", "certspotter"]).optional(),
  }),
  ownership: z.object({
    domain: z.string(),
    record: z.string(),
    verifiedAt: z.string(),
    source: z.enum(["live", "fixture"]),
  }),
  hostnames: z.array(
    z.object({
      name: z.string(),
      wildcard: z.boolean(),
      sources: z.array(z.enum(["ct", "dns"])),
      certCount: z.number().int().nonnegative(),
      activeCertCount: z.number().int().nonnegative(),
      firstIssued: z.string().optional(),
      lastExpiry: z.string().optional(),
      resolves: z.boolean().nullable(),
      addresses: z.array(z.string()),
    }),
  ),
  remoteAccessCandidates: z.array(
    z.object({
      hostname: z.string(),
      kind: z.enum(["vpn", "rdp"]),
      pattern: z.string(),
      current: z.boolean(),
      reasonJa: z.string(),
      evidence: z.array(Evidence),
      ipaCases: z.array(z.number().int()),
    }),
  ),
  mail: z.object({
    mx: z.array(z.object({ exchange: z.string(), priority: z.number().int() })),
    spf: z.object({
      present: z.boolean(),
      record: z.string().optional(),
      includes: z.array(z.string()),
      allMechanism: z.enum(["-all", "~all", "?all", "+all"]).optional(),
      evidence: z.array(Evidence),
    }),
    dmarc: z.object({
      present: z.boolean(),
      record: z.string().optional(),
      policy: z.enum(["none", "quarantine", "reject"]).optional(),
      subdomainPolicy: z.enum(["none", "quarantine", "reject"]).optional(),
      evidence: z.array(Evidence),
    }),
    provider: Provider,
  }),
  cloudServices: z.array(
    z.object({
      name: z.string(),
      via: z.enum(["spf_include", "mx", "cname"]),
      evidence: z.array(Evidence),
    }),
  ),
  web: z.object({
    hostnames: z.array(z.string()),
    records: z.array(Evidence),
    hosting: Provider,
  }),
  findings: z.array(Finding),
  notesJa: z.array(z.string()),
});

const Contradiction = z.object({
  assetId: z.string(),
  messageJa: z.string(),
  external: z.string(),
  registered: z.string(),
});

export const ReconRecording = z.object({
  version: z.literal(RECON_RECORDING_VERSION),
  /** 外部確認したドメイン（所有確認済みの実ドメイン） */
  domain: z.string(),
  /** 記録した日時（ISO 8601、UTC） */
  recordedAt: z.string(),
  note: z.string(),
  /** 参照したものと、記録に加えた処置 */
  provenance: z.object({
    dns: z.literal("live"),
    /** 証明書の公開ログ。応答のキャッシュを使い、記録のときに新しく問い合わせたかを残す */
    ct: z.object({
      provider: z.enum(["crtsh", "certspotter"]),
      cachedAt: z.string(),
      queriedNow: z.boolean(),
    }),
    /** 記録に入れなかった／置き換えたもの */
    redactions: z.array(z.string()),
    targetHostsAccessed: z.literal(false),
  }),
  /** 外部確認の結果（API の /run が返す RunView 相当。反映後のカルテは入れない） */
  run: z.object({
    domain: z.string(),
    fixture: z.literal(false),
    result: Result,
    answersHints: z.custom<AnswerHints>((v) => typeof v === "object" && v !== null),
    assetHints: z.custom<AssetHint[]>((v) => Array.isArray(v)),
    ctUnavailableJa: z.string().optional(),
  }),
  /** 反映先のカルテ（架空のデモ精工）と、反映したときの矛盾と差分 */
  applied: z.object({
    profile: z.object({
      id: z.string(),
      companyName: z.string(),
      fictional: z.literal(true),
      domain: z.string().optional(),
    }),
    contradictions: z.array(
      Contradiction.extend({
        /** 食い違いのあった資産の名前（カルテの label） */
        assetLabel: z.string(),
        /** 食い違いのあった、実ドメイン側のホスト名 */
        hostname: z.string(),
      }),
    ),
    changes: z.object({
      attrs: z.array(
        z.object({
          assetId: z.string(),
          assetLabel: z.string(),
          key: z.string(),
          before: z.string().optional(),
          after: z.string(),
          overwrite: z.boolean(),
        }),
      ),
      controls: z.array(
        z.object({
          assetId: z.string(),
          assetLabel: z.string(),
          mitigation: z.string(),
          status: z.string(),
          noteJa: z.string().optional(),
        }),
      ),
      answers: z.array(z.object({ key: z.string(), labelJa: z.string(), after: z.string() })),
      domainChange: z.object({ before: z.string().optional(), after: z.string() }).optional(),
    }),
  }),
});
export type ReconRecording = Omit<z.infer<typeof ReconRecording>, "run"> & {
  run: Omit<z.infer<typeof ReconRecording>["run"], "result"> & { result: ReconResult };
};

/** 文書用の予約範囲（RFC 5737、RFC 3849）以外の IP アドレスが文字列に残っていないか（残りを返す） */
export function findRealIps(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g)) {
    const ip = m[0];
    if (!isDocumentationIpv4(ip)) found.add(ip);
  }
  for (const m of text.matchAll(/[0-9A-Fa-f:]{3,}/g)) {
    const token = m[0];
    if (!token.includes("::") && token.split(":").length < 8) continue;
    if (!/^2001:db8(:|$)/i.test(token)) found.add(token);
  }
  return [...found];
}

export function isDocumentationIpv4(ip: string): boolean {
  return /^(?:192\.0\.2|198\.51\.100|203\.0\.113)\.\d{1,3}$/.test(ip);
}
