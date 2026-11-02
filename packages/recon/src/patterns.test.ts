import { describe, expect, it } from "vitest";
import {
  MX_PROVIDERS,
  matchProvider,
  matchRemoteAccessHost,
  matchSpfInclude,
  WEB_HOSTING_PATTERNS,
} from "./patterns.ts";

describe("VPN・リモートデスクトップ用と推定されるホスト名", () => {
  it.each([
    ["vpn.example.jp", "vpn", "vpn"],
    ["sslvpn2.example.jp", "vpn", "vpn"],
    ["vpn-tokyo.example.jp", "vpn", "vpn"],
    ["tokyo-vpn.example.jp", "vpn", "vpn"],
    ["remote.example.jp", "vpn", "remote-access"],
    ["ras.example.jp", "vpn", "remote-access"],
    ["gw1.example.jp", "vpn", "gateway"],
    ["fw.osaka.example.jp", "vpn", "gateway"],
    ["ssl.example.jp", "vpn", "ssl"],
    ["fortigate.example.jp", "vpn", "fortinet"],
    ["forti-hq.example.jp", "vpn", "fortinet"],
    ["globalprotect.example.jp", "vpn", "vpn-product"],
    ["anyconnect.example.jp", "vpn", "vpn-product"],
    ["access.example.jp", "vpn", "remote-access"],
    ["vdi.example.jp", "rdp", "vdi"],
    ["citrix.example.jp", "rdp", "vdi"],
    ["rdweb.example.jp", "rdp", "rdp"],
    ["rdgw.example.jp", "rdp", "rdp"],
  ])("%s は %s（%s）", (host, kind, pattern) => {
    const hit = matchRemoteAccessHost(host, "example.jp");
    expect(hit?.pattern.kind).toBe(kind);
    expect(hit?.pattern.name).toBe(pattern);
  });
  it.each([
    "www.example.jp",
    "mail.example.jp",
    "autodiscover.example.jp",
    "example.jp",
    "campaign2019.example.jp",
    "sslcert.example.jp",
    "vpnews.example.jp",
  ])("%s は当たらない", (host) => {
    expect(matchRemoteAccessHost(host, "example.jp")).toBeUndefined();
  });
  it("別ドメインのホスト名は対象外", () => {
    expect(matchRemoteAccessHost("vpn.other.jp", "example.jp")).toBeUndefined();
  });
});

describe("MX からの提供元", () => {
  it.each([
    ["example-jp.mail.protection.outlook.com", "Microsoft 365", "cloud"],
    ["aspmx.l.google.com", "Google Workspace", "cloud"],
    ["alt1.aspmx.l.google.com", "Google Workspace", "cloud"],
    ["www1234.sakura.ne.jp", "さくらインターネット", "provider"],
    ["sv1234.xserver.jp", "エックスサーバー", "provider"],
    ["mx.lolipop.jp", "ロリポップ！（GMOペパボ）", "provider"],
  ])("%s → %s（%s）", (mx, name, kind) => {
    const hit = matchProvider(mx, MX_PROVIDERS);
    expect(hit?.name).toBe(name);
    expect(hit?.kind).toBe(kind);
  });
  it("ゲートウェイ製品は受信箱の提供元と区別する", () => {
    expect(matchProvider("mx0a-0001.pphosted.com", MX_PROVIDERS)?.role).toBe("gateway");
  });
  it("表にないものは undefined（断定しない）", () => {
    expect(matchProvider("mail.unknown-provider.example", MX_PROVIDERS)).toBeUndefined();
  });
});

describe("SPF の include からのクラウドサービス", () => {
  it.each([
    ["spf.protection.outlook.com", "Microsoft 365"],
    ["_spf.google.com", "Google Workspace"],
    ["amazonses.com", "Amazon SES"],
    ["sendgrid.net", "SendGrid"],
  ])("%s → %s", (include, name) => {
    expect(matchSpfInclude(include)).toBe(name);
  });
  it("表にないものは undefined", () => {
    expect(matchSpfInclude("spf.unknown.example")).toBeUndefined();
  });
});

describe("ホームページの置き場所の手がかり", () => {
  it.each([
    ["www1234.sakura.ne.jp", "さくらインターネット", "provider"],
    ["sv1.xserver.jp", "エックスサーバー", "provider"],
    ["d111111abcdef8.cloudfront.net", "AWS", "cloud"],
    ["example.github.io", "GitHub Pages", "cloud"],
  ])("%s → %s（%s）", (host, name, kind) => {
    const hit = matchProvider(host, WEB_HOSTING_PATTERNS);
    expect(hit?.name).toBe(name);
    expect(hit?.kind).toBe(kind);
  });
  it("CDN は実体の置き場所が分からないので unknown", () => {
    expect(matchProvider("example.cdn.cloudflare.net", WEB_HOSTING_PATTERNS)?.kind).toBe("unknown");
  });
});
