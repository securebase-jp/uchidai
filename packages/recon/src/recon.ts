/**
 * 外部確認の本体。所有確認に通ったドメインについて、DNS と CT だけから確認項目を組み立てる。
 *
 * ネットワークに出るのは DnsResolver（DNS サーバへの問い合わせ）と CtLogSource（crt.sh、空か失敗のときだけ Cert Spotter）だけ。
 * ホスト名が見つかっても、そのホストには接続しない（名前解決の問い合わせ先は DNS サーバ）。
 */
import { FileCache } from "./cache.ts";
import { CertSpotterSource } from "./certspotter.ts";
import { CrtShSource } from "./crtsh.ts";
import { FallbackCtSource } from "./fallback-ct.ts";
import {
  assertVerified,
  defaultResolver,
  isLiveResolver,
  OwnershipNotVerifiedError,
  sourceOf,
  type VerifiedDomain,
} from "./ownership.ts";
import {
  IPA_SOURCE_JA,
  IPA_UNKNOWN_ASSETS_JA,
  IPA_VULN_CASES,
  MX_PROVIDERS,
  matchProvider,
  matchRemoteAccessHost,
  matchSpfInclude,
  WEB_HOSTING_PATTERNS,
} from "./patterns.ts";
import type { FetchLike } from "./proxy.ts";
import type { CtLogSource, CtRunInfo, DnsResolver, ReconCache } from "./sources.ts";
import {
  type CloudService,
  type CtCertificate,
  type DmarcInfo,
  type Evidence,
  type Finding,
  type HostnameEntry,
  isLookupSafeName,
  type MailInfo,
  type MxRecord,
  normalizeDomain,
  type ProviderGuess,
  ReconResult,
  type RemoteAccessCandidate,
  type SpfInfo,
  type WebInfo,
} from "./types.ts";

export interface ReconOptions {
  /** verifyOwnership の結果。無い、または別ドメインのものなら OwnershipNotVerifiedError */
  ownership: VerifiedDomain;
  resolver?: DnsResolver;
  ct?: CtLogSource;
  /** ct を省いたときの crt.sh・Cert Spotter のキャッシュ */
  cache?: ReconCache;
  now?: () => Date;
  /** CT で見つかったホスト名のうち、DNS で名前解決を確かめる上限 */
  maxHostLookups?: number;
  /** 所有確認から経過してよい時間（既定 24 時間） */
  ownershipMaxAgeMs?: number;
}

/** CNAME をたどる上限（DNS の問い合わせだけ。ホストにはつながない） */
const MAX_CNAME_HOPS = 3;
const SPF_ALL_VALUES = ["-all", "~all", "?all", "+all"] as const;

export interface LiveCtOptions {
  cache?: ReconCache;
  /** 差し替え用（テストではここに偽の fetch を渡す）。検査を通った URL でしか呼ばれない */
  fetch?: FetchLike;
}

/** 実際の CT 参照：crt.sh を先に使い、空か失敗のときだけ Cert Spotter（同じキャッシュを共有。キーは別） */
export function createLiveCtSource(options: LiveCtOptions = {}): CtLogSource {
  const shared = options.cache ?? new FileCache();
  const fetchOption = options.fetch ? { fetch: options.fetch } : {};
  return new FallbackCtSource({
    primary: new CrtShSource({ cache: shared, ...fetchOption }),
    secondary: new CertSpotterSource({ cache: shared, ...fetchOption }),
  });
}

let defaultCtFactory: (cache?: ReconCache) => CtLogSource = (cache) =>
  createLiveCtSource(cache ? { cache } : {});
/** 既定の CT 参照の実装を差し替える */
export function setDefaultCtSource(factory: (cache?: ReconCache) => CtLogSource): void {
  defaultCtFactory = factory;
}

const dns = (recordType: string, name: string, value: string): Evidence => ({
  kind: "dns",
  recordType,
  name,
  value,
});
const ctEvidence = (domain: string, cert: CtCertificate): Evidence => ({
  kind: "ct",
  recordType: "certificate",
  name: domain,
  value: `${cert.names.join(", ")}（発行 ${cert.notBefore.slice(0, 10)}、期限 ${cert.notAfter.slice(0, 10)}、${cert.issuer}）`,
});

async function safe<T>(work: () => Promise<T[]>, notes: string[], what: string): Promise<T[]> {
  try {
    return await work();
  } catch (error) {
    notes.push(`${what} を参照できなかった: ${(error as Error).message}`);
    return [];
  }
}

// ---------------------------------------------------------------------------
// ホスト名（CT）
// ---------------------------------------------------------------------------
export function collectHostnames(
  domain: string,
  certs: CtCertificate[],
  now: Date,
): Map<string, HostnameEntry> {
  const map = new Map<string, HostnameEntry>();
  for (const cert of certs) {
    const active = new Date(cert.notAfter).getTime() > now.getTime();
    for (const raw of cert.names) {
      const name = raw.toLowerCase();
      if (name !== domain && !name.endsWith(`.${domain}`)) continue;
      const entry = map.get(name) ?? {
        name,
        wildcard: name.startsWith("*."),
        sources: ["ct"],
        certCount: 0,
        activeCertCount: 0,
        resolves: null,
        addresses: [],
      };
      entry.certCount += 1;
      if (active) entry.activeCertCount += 1;
      if (!entry.firstIssued || cert.notBefore < entry.firstIssued)
        entry.firstIssued = cert.notBefore;
      if (!entry.lastExpiry || cert.notAfter > entry.lastExpiry) entry.lastExpiry = cert.notAfter;
      map.set(name, entry);
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// メール認証
// ---------------------------------------------------------------------------
export function parseSpf(domain: string, txt: string[]): SpfInfo {
  const records = txt.filter((r) => /^v=spf1(\s|$)/i.test(r.trim()));
  const record = records[0];
  if (!record) return { present: false, includes: [], evidence: [] };
  const terms = record.trim().split(/\s+/).slice(1);
  const includes = terms
    .filter((t) => /^[+?~-]?(include:|redirect=)/i.test(t))
    .map((t) => t.replace(/^[+?~-]?(include:|redirect=)/i, "").toLowerCase());
  const all = terms.find((t) => /^[+?~-]?all$/i.test(t))?.toLowerCase();
  const allMechanism = SPF_ALL_VALUES.find((v) => v === (all?.length === 3 ? `+${all}` : all));
  return {
    present: true,
    record,
    includes,
    ...(allMechanism ? { allMechanism } : {}),
    evidence: records.map((r) => dns("TXT", domain, r)),
  };
}

export function parseDmarc(domain: string, txt: string[]): DmarcInfo {
  const name = `_dmarc.${domain}`;
  const records = txt.filter((r) => /^v=DMARC1(\s*;|$)/i.test(r.trim()));
  const record = records[0];
  if (!record) return { present: false, evidence: [] };
  const tags = new Map<string, string>();
  for (const part of record.split(";")) {
    const [k, v] = part.split("=").map((s) => s?.trim().toLowerCase());
    if (k && v) tags.set(k, v);
  }
  const policy = (["none", "quarantine", "reject"] as const).find((p) => p === tags.get("p"));
  const sp = (["none", "quarantine", "reject"] as const).find((p) => p === tags.get("sp"));
  return {
    present: true,
    record,
    ...(policy ? { policy } : {}),
    ...(sp ? { subdomainPolicy: sp } : {}),
    evidence: records.map((r) => dns("TXT", name, r)),
  };
}

export function guessMailProvider(domain: string, mx: MxRecord[]): ProviderGuess {
  const evidence = mx.map((m) => dns("MX", domain, `${m.priority} ${m.exchange}`));
  if (mx.length === 0) {
    return {
      kind: "unknown",
      reasonJa: "MX レコードがない（メールを受け取らないか、未設定）",
      evidence,
    };
  }
  const sorted = [...mx]
    .filter((m) => m.exchange !== "" && m.exchange !== ".")
    .sort((a, b) => a.priority - b.priority);
  if (sorted.length === 0) {
    return {
      kind: "unknown",
      reasonJa: "Null MX（RFC 7505）。このドメインではメールを受け取らないと宣言している",
      evidence,
    };
  }
  for (const m of sorted) {
    const hit = matchProvider(m.exchange, MX_PROVIDERS);
    if (!hit) continue;
    if (hit.role === "gateway") {
      return {
        name: hit.name,
        kind: "unknown",
        reasonJa: `MX が ${hit.name} のメールゲートウェイを指している。受信箱の提供元はこの先にあり、MX からは分からない`,
        evidence,
      };
    }
    return {
      name: hit.name,
      kind: hit.kind,
      reasonJa: `MX（${m.exchange}）が ${hit.name} の配下にある`,
      evidence,
    };
  }
  const own = sorted.find((m) => m.exchange === domain || m.exchange.endsWith(`.${domain}`));
  if (own) {
    return {
      kind: "onprem",
      reasonJa: `MX（${own.exchange}）が自社ドメイン内の名前。社内または自社管理のメールサーバの可能性（断定はできない）`,
      evidence,
    };
  }
  return {
    kind: "unknown",
    reasonJa: `MX（${sorted[0]?.exchange}）は表にない提供元`,
    evidence,
  };
}

export function cloudServicesFromSpf(domain: string, spf: SpfInfo): CloudService[] {
  const seen = new Map<string, CloudService>();
  for (const include of spf.includes) {
    const name = matchSpfInclude(include);
    if (!name || seen.has(name)) continue;
    seen.set(name, {
      name,
      via: "spf_include",
      evidence: [dns("TXT", domain, `include:${include}`)],
    });
  }
  return [...seen.values()];
}

// ---------------------------------------------------------------------------
// ホームページの置き場所
// ---------------------------------------------------------------------------
async function webInfo(domain: string, resolver: DnsResolver, notes: string[]): Promise<WebInfo> {
  const hostnames = [domain, `www.${domain}`];
  const records: Evidence[] = [];
  const candidates: string[] = [];
  for (const name of hostnames) {
    const cnames = await safe(() => resolver.resolveCname(name), notes, `${name} の CNAME`);
    for (const c of cnames) {
      records.push(dns("CNAME", name, c));
      candidates.push(c);
    }
    // CNAME の連鎖（www → cdn.自社 → 事業者）を上限つきでたどる。問い合わせ先は DNS サーバだけ
    let target = cnames[0];
    for (let hop = 1; target && hop < MAX_CNAME_HOPS; hop++) {
      if (!isLookupSafeName(target)) break;
      const t = target;
      const next = await safe(() => resolver.resolveCname(t), notes, `${t} の CNAME`);
      for (const c of next) {
        records.push(dns("CNAME", t, c));
        candidates.push(c);
      }
      target = next[0];
    }
    if (cnames.length > 0) continue;
    const a = await safe(() => resolver.resolve4(name), notes, `${name} の A`);
    for (const ip of a) records.push(dns("A", name, ip));
    const aaaa = await safe(() => resolver.resolve6(name), notes, `${name} の AAAA`);
    for (const ip of aaaa) records.push(dns("AAAA", name, ip));
    const first = a[0];
    if (first && resolver.resolvePtr) {
      const ptr = await safe(
        () => resolver.resolvePtr?.(first) ?? Promise.resolve([]),
        notes,
        `${first} の逆引き`,
      );
      for (const p of ptr) {
        records.push(dns("PTR", first, p));
        candidates.push(p);
      }
    }
  }
  for (const c of candidates) {
    const hit = matchProvider(c, WEB_HOSTING_PATTERNS);
    if (hit) {
      return {
        hostnames,
        records,
        hosting: {
          name: hit.name,
          kind: hit.kind,
          reasonJa: `ホームページの名前が ${c} を指しており、${hit.name} の配下と推定（手がかりであり断定しない）`,
          evidence: records,
        },
      };
    }
  }
  const own = candidates.find((c) => c === domain || c.endsWith(`.${domain}`));
  if (own) {
    return {
      hostnames,
      records,
      hosting: {
        kind: "onprem",
        reasonJa: `逆引き・CNAME が自社ドメイン内の名前（${own}）。自社管理のサーバの可能性（断定はできない）`,
        evidence: records,
      },
    };
  }
  return {
    hostnames,
    records,
    hosting: {
      kind: "unknown",
      reasonJa:
        records.length === 0
          ? "ホームページの名前（ドメインと www）に A／CNAME レコードがない"
          : "レコードはあるが、表にある事業者の手がかりはない",
      evidence: records,
    },
  };
}

// ---------------------------------------------------------------------------
// 確認項目（画面に出す行）
// ---------------------------------------------------------------------------
function buildFindings(
  domain: string,
  hostnames: HostnameEntry[],
  candidates: RemoteAccessCandidate[],
  mail: MailInfo,
  cloud: CloudService[],
  web: WebInfo,
  ctAvailable: boolean,
): Finding[] {
  const findings: Finding[] = [];
  const ipaVpn = [...IPA_VULN_CASES.vpnExposed];
  const wildcards = hostnames.filter((h) => h.wildcard).length;
  const stale = hostnames.filter(
    (h) => !h.wildcard && h.resolves === false && h.activeCertCount === 0 && h.certCount > 0,
  );

  findings.push({
    id: "hostnames.ct",
    category: "hostnames",
    severity: "info",
    titleJa: ctAvailable
      ? `証明書の公開ログに ${hostnames.length} 件のホスト名`
      : "証明書の公開ログを参照できなかった",
    detailJa: ctAvailable
      ? `${domain} とそのサブドメインに発行された証明書から集めた名前。うち現在も有効な証明書があるのは ${hostnames.filter((h) => h.activeCertCount > 0).length} 件、DNS で名前が解決できるのは ${hostnames.filter((h) => h.resolves === true).length} 件${wildcards > 0 ? `。ワイルドカード証明書（*.）が ${wildcards} 件あり、その配下の個別のホスト名は公開ログからは分からない` : ""}${stale.length > 0 ? `。証明書が期限切れで DNS にも無い名前が ${stale.length} 件（${stale.map((h) => h.name).join("、")}）。担当者が把握していない過去の資産の可能性があり、カルテとの照合に使う` : ""}`
      : "ホスト名の洗い出しと VPN 用ホスト名の推定は DNS だけで行った",
    evidence: [],
    ipaCases: [],
    ...(stale.length > 0 ? { sourceJa: `${IPA_SOURCE_JA} ${IPA_UNKNOWN_ASSETS_JA}` } : {}),
  });

  const expired = hostnames.filter(
    (h) => !h.wildcard && h.resolves === true && h.activeCertCount === 0 && h.certCount > 0,
  );
  if (expired.length > 0) {
    findings.push({
      id: "certificates.expired",
      category: "hostnames",
      severity: "warn",
      titleJa: `証明書が期限切れのまま DNS に残る名前が ${expired.length} 件`,
      detailJa: `${expired.map((h) => `${h.name}（最後の期限 ${h.lastExpiry?.slice(0, 10)}）`).join("、")}。公開ログに新しい証明書の記録がなく、名前は今も解決できる。更新忘れか、使っていないのに残っている可能性（接続して確かめることはしない）`,
      evidence: [],
      ipaCases: [...IPA_VULN_CASES.certExpired],
      sourceJa: IPA_SOURCE_JA,
    });
  }

  const vpn = candidates.filter((c) => c.kind === "vpn");
  const vpnCurrent = vpn.filter((c) => c.current);
  findings.push(
    vpn.length > 0
      ? {
          id: "remote_access.vpn",
          category: "remote_access",
          severity: vpnCurrent.length > 0 ? "warn" : "info",
          titleJa:
            vpnCurrent.length > 0
              ? `VPN 用と推定されるホスト名が ${vpnCurrent.length} 件公開されている`
              : `VPN 用と推定されるホスト名が過去に ${vpn.length} 件あった（今は DNS になく証明書も期限切れ）`,
          detailJa: `${vpn.map((c) => `${c.hostname}${c.current ? "" : "（過去の痕跡）"}`).join("、")}。名前のパターンからの推定で、装置の有無や種類は断定しない。公開された VPN 装置の更新漏れは事例集の脆弱性事例 ${ipaVpn.join("・")} で中小企業に実際に見つかった弱点`,
          evidence: vpn.flatMap((c) => c.evidence),
          ipaCases: ipaVpn,
          sourceJa: IPA_SOURCE_JA,
        }
      : {
          id: "remote_access.vpn",
          category: "remote_access",
          severity: "ok",
          titleJa: "VPN 用と推定されるホスト名は見つからなかった",
          detailJa:
            "DNS と証明書の公開ログに、VPN 用とよく使われる名前はなかった。IP アドレス直指定の VPN 装置は見つけられない",
          evidence: [],
          ipaCases: ipaVpn,
          sourceJa: IPA_SOURCE_JA,
        },
  );
  const rdp = candidates.filter((c) => c.kind === "rdp");
  if (rdp.length > 0) {
    findings.push({
      id: "remote_access.rdp",
      category: "remote_access",
      severity: "warn",
      titleJa: `リモートデスクトップ用と推定されるホスト名が ${rdp.length} 件公開されている`,
      detailJa: `${rdp.map((c) => c.hostname).join("、")}。名前のパターンからの推定`,
      evidence: rdp.flatMap((c) => c.evidence),
      ipaCases: [...IPA_VULN_CASES.rdpExposed],
      sourceJa: IPA_SOURCE_JA,
    });
  }

  const spfDuplicated = mail.spf.evidence.length > 1;
  findings.push(
    mail.spf.present
      ? {
          id: "mail_auth.spf",
          category: "mail_auth",
          severity:
            spfDuplicated || mail.spf.allMechanism === "+all" || mail.spf.allMechanism === "?all"
              ? "warn"
              : "ok",
          titleJa: spfDuplicated
            ? `SPF のレコードが ${mail.spf.evidence.length} 件ある（受信側で無効と扱われる）`
            : "SPF が設定されている",
          detailJa: `送信元として許可するサーバが宣言されている（${mail.spf.allMechanism ?? "all なし"}）。include: ${mail.spf.includes.join(", ") || "なし"}${spfDuplicated ? "。v=spf1 の TXT は 1 件だけにする必要がある" : ""}`,
          evidence: mail.spf.evidence,
          ipaCases: [...IPA_VULN_CASES.mailAuth],
        }
      : {
          id: "mail_auth.spf",
          category: "mail_auth",
          severity: "warn",
          titleJa: "SPF が設定されていない",
          detailJa: "自社ドメインを差出人にしたなりすましメールを、受信側が見分ける手がかりがない",
          evidence: [],
          ipaCases: [...IPA_VULN_CASES.mailAuth],
        },
  );
  const dmarcDuplicated = mail.dmarc.evidence.length > 1;
  findings.push(
    mail.dmarc.present
      ? {
          id: "mail_auth.dmarc",
          category: "mail_auth",
          severity:
            dmarcDuplicated || mail.dmarc.policy === "none" || !mail.dmarc.policy ? "warn" : "ok",
          titleJa: dmarcDuplicated
            ? `DMARC のレコードが ${mail.dmarc.evidence.length} 件ある（受信側で無効と扱われる）`
            : `DMARC が設定されている（p=${mail.dmarc.policy ?? "不明"}）`,
          detailJa:
            mail.dmarc.policy === "none"
              ? "監視のみの設定。なりすましメールは受信側で隔離・拒否されない"
              : !mail.dmarc.policy
                ? "p= の指定が読み取れない（必須のタグ）。受信側で無効と扱われるおそれ"
                : "認証に失敗したメールの扱い（隔離・拒否）が宣言されている",
          evidence: mail.dmarc.evidence,
          ipaCases: [...IPA_VULN_CASES.mailAuth],
        }
      : {
          id: "mail_auth.dmarc",
          category: "mail_auth",
          severity: "warn",
          titleJa: "DMARC が設定されていない",
          detailJa: `_dmarc.${domain} の TXT レコードがない。自社ドメインを装ったメールが取引先に届いても、受信側が隔離・拒否する根拠がない`,
          evidence: [],
          ipaCases: [...IPA_VULN_CASES.mailAuth],
        },
  );
  findings.push({
    id: "mail_provider.mx",
    category: "mail_provider",
    severity: "info",
    titleJa: mail.provider.name
      ? `メールの提供元は ${mail.provider.name} と推定`
      : mail.provider.kind === "onprem"
        ? "メールサーバは自社管理の可能性"
        : "メールの提供元は不明",
    detailJa: mail.provider.reasonJa,
    evidence: mail.provider.evidence,
    ipaCases: [],
  });
  if (cloud.length > 0) {
    findings.push({
      id: "cloud_services.spf",
      category: "cloud_services",
      severity: "info",
      titleJa: `SPF の include から ${cloud.map((c) => c.name).join("、")} の利用が分かる`,
      detailJa: "メール送信を許可しているサービス。利用中のクラウドサービスの手がかり",
      evidence: cloud.flatMap((c) => c.evidence),
      ipaCases: [],
    });
  }
  findings.push({
    id: "web_hosting.hint",
    category: "web_hosting",
    severity: "info",
    titleJa: web.hosting.name
      ? `ホームページは ${web.hosting.name} に置かれていると推定`
      : web.hosting.kind === "onprem"
        ? "ホームページは自社管理のサーバの可能性"
        : "ホームページの置き場所は不明",
    detailJa: web.hosting.reasonJa,
    evidence: web.records,
    ipaCases: [],
  });
  return findings;
}

// ---------------------------------------------------------------------------
// 本体
// ---------------------------------------------------------------------------
export async function recon(domainInput: string, options: ReconOptions): Promise<ReconResult> {
  const domain = normalizeDomain(domainInput);
  const now = options.now ?? (() => new Date());
  const ownership = assertVerified(domain, options.ownership, {
    now,
    ...(options.ownershipMaxAgeMs === undefined ? {} : { maxAgeMs: options.ownershipMaxAgeMs }),
  });
  const resolver = options.resolver ?? defaultResolver();
  const ct = options.ct ?? defaultCtFactory(options.cache);
  // 実際の検索サービスにつなぐ実装は lastRun を持つ（fixture の再生は持たない）
  const ctLive = typeof ct.lastRun === "function";
  // fixture（記録）で通した所有確認で、実際の DNS や crt.sh に問い合わせることは許さない
  if (ownership.source === "fixture" && (isLiveResolver(resolver) || ctLive)) {
    throw new OwnershipNotVerifiedError(
      domain,
      "記録（fixture）による所有確認では、実際の DNS・証明書ログを参照しない",
    );
  }
  const notes: string[] = [];
  const checkedAt = now().toISOString();

  // CT：サブドメインの洗い出し
  let ctAvailable = true;
  let certs: CtCertificate[] = [];
  let ctRun: CtRunInfo | undefined;
  try {
    certs = await ct.listCertificates(domain);
    ctRun = ct.lastRun?.(domain);
    if (ctRun) notes.push(...ctRun.notesJa);
  } catch (error) {
    ctAvailable = false;
    notes.push(
      `証明書の公開ログ（crt.sh、予備の Cert Spotter）を参照できなかった: ${(error as Error).message}`,
    );
  }
  const hostMap = collectHostnames(domain, certs, now());

  // DNS：名前が今も解決できるか（問い合わせ先は DNS サーバ。ホストにはつながない）
  const limit = options.maxHostLookups ?? 100;
  let looked = 0;
  for (const entry of hostMap.values()) {
    if (entry.wildcard) continue;
    // 証明書の名前は第三者が書けるデータ。ホスト名として正しいものだけを DNS に問い合わせる
    if (!isLookupSafeName(entry.name)) {
      notes.push(`証明書にホスト名として扱えない名前があり、名前解決を省いた: ${entry.name}`);
      continue;
    }
    if (looked >= limit) {
      notes.push(`ホスト名が ${hostMap.size} 件あり、名前解決の確認は ${limit} 件で打ち切った`);
      break;
    }
    looked += 1;
    const a = await safe(() => resolver.resolve4(entry.name), notes, `${entry.name} の A`);
    const aaaa =
      a.length > 0
        ? []
        : await safe(() => resolver.resolve6(entry.name), notes, `${entry.name} の AAAA`);
    const cname =
      a.length + aaaa.length > 0
        ? []
        : await safe(() => resolver.resolveCname(entry.name), notes, `${entry.name} の CNAME`);
    entry.addresses = [...a, ...aaaa, ...cname];
    entry.resolves = entry.addresses.length > 0;
    if (entry.resolves) entry.sources = ["ct", "dns"];
  }
  const hostnames = [...hostMap.values()].sort((a, b) => a.name.localeCompare(b.name));

  // VPN・リモートデスクトップ用と推定されるホスト名
  const candidates: RemoteAccessCandidate[] = [];
  for (const entry of hostnames) {
    if (entry.wildcard) continue;
    const hit = matchRemoteAccessHost(entry.name, domain);
    if (!hit) continue;
    const evidence: Evidence[] = certs
      .filter((c) => c.names.includes(entry.name))
      .slice(0, 3)
      .map((c) => ctEvidence(domain, c));
    for (const addr of entry.addresses)
      evidence.push(
        dns(addr.includes(":") ? "AAAA" : /^\d/.test(addr) ? "A" : "CNAME", entry.name, addr),
      );
    candidates.push({
      hostname: entry.name,
      kind: hit.pattern.kind,
      pattern: hit.pattern.name,
      current: entry.resolves === true || entry.activeCertCount > 0,
      reasonJa: `ホスト名の「${hit.label}」が${hit.pattern.labelJa}に当たる${entry.resolves ? "。DNS で名前も解決できる" : entry.resolves === false ? "。DNS には名前がない（証明書の記録だけ）" : ""}`,
      evidence,
      ipaCases: [
        ...(hit.pattern.kind === "vpn" ? IPA_VULN_CASES.vpnExposed : IPA_VULN_CASES.rdpExposed),
      ],
    });
  }

  // メール
  const apexTxt = await safe(() => resolver.resolveTxt(domain), notes, `${domain} の TXT`);
  const dmarcTxt = await safe(
    () => resolver.resolveTxt(`_dmarc.${domain}`),
    notes,
    `_dmarc.${domain} の TXT`,
  );
  const mx = await safe(() => resolver.resolveMx(domain), notes, `${domain} の MX`);
  const spf = parseSpf(domain, apexTxt);
  const dmarc = parseDmarc(domain, dmarcTxt);
  const mail: MailInfo = { mx, spf, dmarc, provider: guessMailProvider(domain, mx) };
  const cloudServices = cloudServicesFromSpf(domain, spf);

  // ホームページ
  const web = await webInfo(domain, resolver, notes);

  const result: ReconResult = {
    domain,
    checkedAt,
    sources: {
      dns: sourceOf(resolver),
      ct: ctAvailable ? (ctLive ? "live" : "fixture") : "unavailable",
      ...(ctAvailable && ctLive && ctRun ? { ctProvider: ctRun.provider } : {}),
    },
    ownership,
    hostnames,
    remoteAccessCandidates: candidates,
    mail,
    cloudServices,
    web,
    findings: buildFindings(domain, hostnames, candidates, mail, cloudServices, web, ctAvailable),
    notesJa: notes,
  };
  return ReconResult.parse(result);
}
