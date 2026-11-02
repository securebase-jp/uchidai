/**
 * 推定に使う固定表。Claude は使わず、ここに書いた表だけで決める。
 *
 * - VPN・リモートデスクトップ用と推定されるホスト名のパターン
 *   出典：IPA「中小企業のための実例で学ぶサイバーセキュリティリスク事例集」脆弱性事例 8・9
 *   （VPN 装置の公開と更新漏れ）。ホスト名の「推定」であり、装置の有無や種類を断定しない
 * - MX からのメール提供元、SPF の include からのクラウドサービス、CNAME／逆引きからのレンタルサーバ事業者
 *   代表的なものだけ。表に無ければ「不明」とし、断定しない
 */
import type { RemoteAccessKind } from "./types.ts";

/** IPA 事例集の脆弱性事例の番号。項目ごとに添える */
export const IPA_VULN_CASES = {
  /** VPN 装置がインターネットに公開され、更新されていなかった事例 */
  vpnExposed: [8, 9],
  /** リモートデスクトップの公開 */
  rdpExposed: [] as number[],
  /** なりすましメール対策（SPF／DMARC）。該当番号は S0 が事例集で確認して記入する */
  mailAuth: [] as number[],
} as const;

export const IPA_SOURCE_JA =
  "IPA「中小企業のための実例で学ぶサイバーセキュリティリスク事例集」（2026年3月）";

export interface HostPattern {
  name: string;
  kind: RemoteAccessKind;
  /** ホスト名のラベル（ドット区切りの 1 要素）に対して評価する */
  test: RegExp;
  labelJa: string;
}

/** ラベル単位で評価する。`vpn-tokyo`、`tokyo-vpn2` のようにハイフン区切りの一部でも当てる */
const label = (words: string, kind: RemoteAccessKind, name: string, labelJa: string) => ({
  name,
  kind,
  test: new RegExp(`(^|-)(${words})\\d*(-|$)`),
  labelJa,
});

export const REMOTE_ACCESS_PATTERNS: readonly HostPattern[] = [
  label("vpn|sslvpn|ssl-vpn|ipsec|openvpn|wireguard", "vpn", "vpn", "VPN を表す語"),
  label("remote|ras|access", "vpn", "remote-access", "社外接続を表す語"),
  label("gw|gateway|fw|firewall|utm", "vpn", "gateway", "ゲートウェイ・ファイアウォールを表す語"),
  label("ssl", "vpn", "ssl", "SSL-VPN の略称としてよく使われる語"),
  label("forti|fortigate|fortinet", "vpn", "fortinet", "VPN 機能を持つ装置の製品名"),
  label(
    "globalprotect|gp-vpn|anyconnect|pulse|ivanti|netscaler|sonicwall",
    "vpn",
    "vpn-product",
    "VPN 製品名",
  ),
  label("vdi|citrix|workspace", "rdp", "vdi", "仮想デスクトップを表す語"),
  label(
    "rdweb|rdgw|rdgateway|rdp|ts|terminal|remoteapp",
    "rdp",
    "rdp",
    "リモートデスクトップを表す語",
  ),
];

export interface HostMatch {
  pattern: HostPattern;
  label: string;
}

/** ホスト名の、ドメインより左の部分をパターンに当てる。当たらなければ undefined */
export function matchRemoteAccessHost(hostname: string, domain: string): HostMatch | undefined {
  const suffix = `.${domain}`;
  if (!hostname.endsWith(suffix)) return undefined;
  const sub = hostname.slice(0, -suffix.length);
  for (const part of sub.split(".")) {
    if (part === "*" || part === "") continue;
    for (const pattern of REMOTE_ACCESS_PATTERNS) {
      if (pattern.test.test(part)) return { pattern, label: part };
    }
  }
  return undefined;
}

export type HostingKind = "cloud" | "provider" | "onprem" | "unknown";

export interface ProviderPattern {
  test: RegExp;
  name: string;
  kind: HostingKind;
  /** メールの場合：受信箱の提供元か、前段のゲートウェイか */
  role?: "mailbox" | "gateway";
}

/** MX のホスト名からメールの提供元を推定する表 */
export const MX_PROVIDERS: readonly ProviderPattern[] = [
  {
    test: /\.mail\.protection\.outlook\.com$/,
    name: "Microsoft 365",
    kind: "cloud",
    role: "mailbox",
  },
  {
    test: /(^|\.)aspmx\.l\.google\.com$|\.googlemail\.com$/,
    name: "Google Workspace",
    kind: "cloud",
    role: "mailbox",
  },
  { test: /\.zoho\.(com|jp|eu)$/, name: "Zoho Mail", kind: "cloud", role: "mailbox" },
  { test: /\.sakura\.ne\.jp$/, name: "さくらインターネット", kind: "provider", role: "mailbox" },
  { test: /\.xserver\.jp$/, name: "エックスサーバー", kind: "provider", role: "mailbox" },
  { test: /\.lolipop\.jp$/, name: "ロリポップ！（GMOペパボ）", kind: "provider", role: "mailbox" },
  { test: /\.heteml\.jp$/, name: "heteml（GMOペパボ）", kind: "provider", role: "mailbox" },
  { test: /\.kagoya\.net$/, name: "カゴヤ・ジャパン", kind: "provider", role: "mailbox" },
  { test: /\.secureserver\.net$/, name: "GoDaddy", kind: "provider", role: "mailbox" },
  {
    test: /\.pphosted\.com$|\.ppe-hosted\.com$/,
    name: "Proofpoint",
    kind: "unknown",
    role: "gateway",
  },
  { test: /\.mimecast\.(com|co\.jp)$/, name: "Mimecast", kind: "unknown", role: "gateway" },
  { test: /\.iij\.ad\.jp$/, name: "IIJ", kind: "provider", role: "mailbox" },
];

/** SPF の include から分かるクラウドサービス */
export const SPF_INCLUDE_SERVICES: readonly { test: RegExp; name: string }[] = [
  { test: /^spf\.protection\.outlook\.com$/, name: "Microsoft 365" },
  { test: /^_spf\.google\.com$/, name: "Google Workspace" },
  { test: /^amazonses\.com$/, name: "Amazon SES" },
  { test: /^sendgrid\.net$/, name: "SendGrid" },
  { test: /^servers\.mcsv\.net$/, name: "Mailchimp" },
  { test: /^_spf\.salesforce\.com$/, name: "Salesforce" },
  { test: /(^|\.)zoho\.(com|jp|eu)$/, name: "Zoho" },
  { test: /^mail\.zendesk\.com$/, name: "Zendesk" },
  { test: /^spf\.mailjet\.com$/, name: "Mailjet" },
  { test: /^_spf\.sakura\.ne\.jp$|\.sakura\.ne\.jp$/, name: "さくらインターネット" },
];

/** ホームページの CNAME 先、または A レコードの逆引き名から、置き場所の手がかりを得る表 */
export const WEB_HOSTING_PATTERNS: readonly ProviderPattern[] = [
  { test: /\.sakura\.ne\.jp$/, name: "さくらインターネット", kind: "provider" },
  { test: /\.xserver\.jp$/, name: "エックスサーバー", kind: "provider" },
  { test: /\.lolipop\.jp$/, name: "ロリポップ！（GMOペパボ）", kind: "provider" },
  { test: /\.heteml\.jp$/, name: "heteml（GMOペパボ）", kind: "provider" },
  { test: /\.kagoya\.net$/, name: "カゴヤ・ジャパン", kind: "provider" },
  { test: /\.conoha\.(io|ne\.jp)$/, name: "ConoHa（GMO）", kind: "provider" },
  { test: /\.cloudfront\.net$|\.amazonaws\.com$/, name: "AWS", kind: "cloud" },
  {
    test: /\.azurewebsites\.net$|\.azureedge\.net$|\.azurefd\.net$/,
    name: "Microsoft Azure",
    kind: "cloud",
  },
  { test: /\.github\.io$/, name: "GitHub Pages", kind: "cloud" },
  { test: /\.netlify\.(app|com)$/, name: "Netlify", kind: "cloud" },
  { test: /\.vercel-dns\.com$|\.vercel\.app$/, name: "Vercel", kind: "cloud" },
  { test: /\.wixdns\.net$/, name: "Wix", kind: "cloud" },
  { test: /\.squarespace\.com$/, name: "Squarespace", kind: "cloud" },
  {
    test: /\.googleusercontent\.com$|\.googlehosted\.com$|^ghs\.google\.com$/,
    name: "Google",
    kind: "cloud",
  },
  { test: /\.cloudflare\.net$/, name: "Cloudflare（CDN。実体の置き場所は不明）", kind: "unknown" },
];

export function matchProvider(
  hostname: string,
  table: readonly ProviderPattern[],
): ProviderPattern | undefined {
  const h = hostname.toLowerCase().replace(/\.$/, "");
  return table.find((p) => p.test.test(h));
}

export function matchSpfInclude(include: string): string | undefined {
  const h = include.toLowerCase().replace(/\.$/, "");
  return SPF_INCLUDE_SERVICES.find((s) => s.test.test(h))?.name;
}
