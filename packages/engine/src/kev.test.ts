import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  applyKev,
  compareVersions,
  extractVersion,
  type KevCatalog,
  type KevProductsFile,
  kevEntriesFor,
  loadKevProducts,
  matchKev,
  matchProduct,
  normalizeProductText,
} from "./kev.ts";
import { loadProfile, repoRoot } from "./knowledge.ts";
import type { CompanyProfile } from "./types.ts";

let table: KevProductsFile;
let demo: CompanyProfile;
beforeAll(() => {
  table = loadKevProducts();
  demo = loadProfile(join(repoRoot, "examples", "demo-seiko.json"));
});

/** テスト用の小さなカタログ（実データの形。実在の CVE ID だが説明文は省く） */
const entry = (
  cveID: string,
  vendorProject: string,
  product: string,
  dateAdded: string,
  ransom = "Unknown",
) => ({
  cveID,
  vendorProject,
  product,
  vulnerabilityName: `${vendorProject} ${product} ${cveID}`,
  dateAdded,
  shortDescription: "",
  requiredAction: "Apply mitigations per vendor instructions.",
  dueDate: "2025-02-01",
  knownRansomwareCampaignUse: ransom,
  notes: "",
});
const catalog: KevCatalog = {
  title: "CISA Catalog of Known Exploited Vulnerabilities",
  catalogVersion: "2026.10.30",
  dateReleased: "2026-10-30T17:02:45.3665Z",
  count: 9,
  vulnerabilities: [
    entry("CVE-2024-55591", "Fortinet", "FortiOS and FortiProxy", "2025-01-21", "Known"),
    entry("CVE-2025-24472", "Fortinet", "FortiOS and FortiProxy", "2025-04-08", "Known"),
    entry("CVE-2024-21762", "Fortinet", "FortiOS", "2024-02-16", "Known"),
    entry("CVE-2022-40684", "Fortinet", "Multiple Products", "2022-11-01", "Known"),
    entry("CVE-2025-32756", "Fortinet", "Multiple Products", "2025-06-04"),
    entry("CVE-2024-40766", "SonicWall", "SonicOS", "2024-09-30", "Known"),
    entry("CVE-2021-20016", "SonicWall", "SSLVPN SMA100", "2021-11-17", "Known"),
    entry(
      "CVE-2025-0282",
      "Ivanti",
      "Connect Secure, Policy Secure, and ZTA Gateways",
      "2025-01-15",
    ),
    entry("CVE-2019-11510", "Ivanti", "Pulse Connect Secure", "2022-05-03", "Known"),
    entry("CVE-2024-24919", "Check Point", "Quantum Security Gateways", "2024-06-20", "Known"),
  ],
};

describe("製品名の正規化と当てはめ（表記ゆれ）", () => {
  it("全角・大小・空白・ハイフンの違いを吸収する", () => {
    expect(normalizeProductText("Ｆｏｒｔｉ Ｇａｔｅ 60F")).toBe("fortigate60f");
    expect(normalizeProductText("PAN-OS")).toBe("panos");
  });
  it.each([
    ["Fortinet FortiOS", "fortinet-fortios"],
    ["FortiGate 60F", "fortinet-fortios"],
    ["Forti OS", "fortinet-fortios"],
    ["フォーティネット", "fortinet-fortios"],
    ["Ivanti Connect Secure", "ivanti-connect-secure"],
    ["Pulse Secure", "ivanti-connect-secure"],
    ["PAN-OS 10.2", "paloalto-panos"],
    ["Palo Alto GlobalProtect", "paloalto-panos"],
    ["Citrix NetScaler Gateway", "citrix-netscaler"],
    ["Check Point R81.20", "checkpoint-gateway"],
    ["SonicWall TZ 370", "sonicwall-sonicos"],
    ["SonicWall SMA 100", "sonicwall-sma"],
    ["WatchGuard Firebox M290", "watchguard-fireware"],
    ["Sophos XG Firewall", "sophos-firewall"],
    ["ヤマハ RTX1210", "yamaha-rtx"],
    ["QNAP TS-453D", "qnap-nas"],
    ["Synology DS920+", "synology-nas"],
    ["Microsoft Exchange Server 2019", "microsoft-exchange"],
  ])("%s → %s", (input, id) => {
    expect(matchProduct(input, table)?.id).toBe(id);
  });
  it("対応表に無い製品、空の入力は当たらない", () => {
    expect(matchProduct("Buffalo WXR-5950", table)).toBeUndefined();
    expect(matchProduct("", table)).toBeUndefined();
    expect(matchProduct(undefined, table)).toBeUndefined();
  });
});

describe("版の比較", () => {
  it.each([
    ["7.0.14", "7.0.16", -1],
    ["7.0.16", "7.0.16", 0],
    ["7.0.17", "7.0.16", 1],
    ["7.0", "7.0.1", -1],
    ["7.2.0", "7.0.16", 1],
    ["10.2.9", "10.2.9-h1", -1],
    ["10.2.9-h2", "10.2.9-h1", 1],
    ["10.2.10", "10.2.9-h16", 1],
    ["22.7R2", "22.7R2.4", -1],
    ["22.7R2.5", "22.7R2.4", 1],
    ["9.1R18.9", "22.7R2", -1],
    ["14.1-43.56", "14.1-43.56", 0],
    ["14.1-43.50", "14.1-43.56", -1],
    ["14.1", "14.1-8.50", -1],
    ["6.5.4.14-109n", "6.5.4.15-116n", -1],
    ["7.0.1-5035", "7.0.1-5035", 0],
    ["7.0.1-5050", "7.0.1-5035", 1],
    ["R81.10", "R81.20", -1],
    ["11.12.4+541730", "11.12.4", 1],
    ["12.11.3", "12.11.4", -1],
  ])("%s と %s → %i", (a, b, expected) => {
    expect(Math.sign(compareVersions(a, b))).toBe(expected);
  });
  it("入力から版らしい部分を取り出す", () => {
    expect(extractVersion("7.0.14", "dotted")).toBe("7.0.14");
    expect(extractVersion("v7.0.14", "dotted")).toBe("7.0.14");
    expect(extractVersion("FortiOS 7.0.14 build0601", "dotted")).toBe("7.0.14");
    expect(extractVersion("７.０.１４", "dotted")).toBe("7.0.14");
    expect(extractVersion("10.2.9-h1", "dotted")).toBe("10.2.9-h1");
    expect(extractVersion("22.7R2.4", "dotted")).toBe("22.7R2.4");
    expect(extractVersion("Rev.14.01.42", "dotted")).toBe("14.01.42");
    expect(extractVersion("R81.20", "r-release")).toBe("R81.20");
    expect(extractVersion("81.20", "r-release")).toBe("R81.20");
    expect(extractVersion("不明", "dotted")).toBeUndefined();
    expect(extractVersion("", "dotted")).toBeUndefined();
  });
});

describe("KEV カタログからの該当 CVE の抽出", () => {
  it("vendorProject と product のパターンで拾い、kevCves で明示した CVE も足す。無関係な Multiple Products は拾わない", () => {
    const p = table.products.find((x) => x.id === "fortinet-fortios");
    if (!p) throw new Error("fortinet-fortios");
    const ids = kevEntriesFor(p, catalog).map((e) => e.cveID);
    expect(ids).toEqual(["CVE-2025-24472", "CVE-2024-55591", "CVE-2024-21762", "CVE-2022-40684"]);
  });
  it("SonicOS と SMA は別の製品として拾う", () => {
    const os = table.products.find((x) => x.id === "sonicwall-sonicos");
    const sma = table.products.find((x) => x.id === "sonicwall-sma");
    if (!os || !sma) throw new Error("sonicwall");
    expect(kevEntriesFor(os, catalog).map((e) => e.cveID)).toEqual(["CVE-2024-40766"]);
    expect(kevEntriesFor(sma, catalog).map((e) => e.cveID)).toEqual(["CVE-2021-20016"]);
  });
});

describe("matchKev（突き合わせ）", () => {
  it("デモ精工の VPN（FortiOS 7.0.14）は CVE-2024-55591 と CVE-2025-24472 に該当（認証回避）", () => {
    const vpn = demo.assets.find((a) => a.id === "vpn");
    if (!vpn) throw new Error("vpn");
    const m = matchKev(vpn, catalog, table);
    expect(m.product?.id).toBe("fortinet-fortios");
    expect(m.version).toBe("7.0.14");
    expect(m.versionStatus).toBe("affected");
    expect(m.matched.map((x) => x.cve)).toEqual(["CVE-2024-55591", "CVE-2025-24472"]);
    expect(m.matched.every((x) => x.authBypass === true)).toBe(true);
    expect(m.matched[0]?.entry?.knownRansomwareCampaignUse).toBe("Known");
    expect(m.matched[0]?.sourceUrl).toContain("fortiguard");
    // 7.0.14 は CVE-2024-21762（〜7.0.13）には該当しない
    expect(m.cleared).toContain("CVE-2024-21762");
    expect(m.unverified.map((u) => u.cve)).toEqual(["CVE-2022-40684"]);
    expect(m.sourcesJa[0]).toContain("2026.10.30");
  });
  it("7.0.17 に上げると該当しない（範囲未確認の CVE は注記に残る）", () => {
    const m = matchKev({ product: "Fortinet FortiOS", version: "7.0.17" }, catalog, table);
    expect(m.versionStatus).toBe("not_affected");
    expect(m.matched).toEqual([]);
    expect(m.reasonJa).toContain("未確認");
  });
  it("範囲の境界：7.0.16 は該当、7.0.13 は CVE-2024-21762 にも該当、7.2.7 は該当しない", () => {
    const at = (v: string) => matchKev({ product: "FortiGate", version: v }, catalog, table);
    expect(at("7.0.16").matched.map((x) => x.cve)).toEqual(["CVE-2024-55591", "CVE-2025-24472"]);
    expect(at("7.0.13").matched.map((x) => x.cve)).toEqual(
      expect.arrayContaining(["CVE-2024-21762", "CVE-2024-55591"]),
    );
    expect(at("7.2.7").versionStatus).toBe("not_affected");
    expect(at("7.2.6").matched.map((x) => x.cve)).toEqual(["CVE-2024-21762"]);
  });
  it("範囲表で確認した最も古い版より古いと unknown（表に無い脆弱性の可能性）", () => {
    const m = matchKev({ product: "FortiOS", version: "4.3.8" }, catalog, table);
    expect(m.versionStatus).toBe("unknown");
    expect(m.reasonJa).toContain("古く");
  });
  it("版が未登録・読めないときは unknown", () => {
    expect(matchKev({ product: "FortiOS" }, catalog, table).versionStatus).toBe("unknown");
    const m = matchKev({ product: "FortiOS", version: "最新" }, catalog, table);
    expect(m.versionStatus).toBe("unknown");
    expect(m.reasonJa).toContain("読み取れません");
  });
  it("対応表に無い製品は unknown で、理由に製品名が入る", () => {
    const m = matchKev({ product: "Buffalo WXR", version: "1.0" }, catalog, table);
    expect(m.product).toBeUndefined();
    expect(m.versionStatus).toBe("unknown");
    expect(m.reasonJa).toContain("Buffalo WXR");
  });
  it("範囲表の無い製品（Check Point）は、KEV の件数を示して unknown", () => {
    const m = matchKev({ product: "Check Point", version: "R81.20" }, catalog, table);
    expect(m.product?.id).toBe("checkpoint-gateway");
    expect(m.version).toBe("R81.20");
    expect(m.versionStatus).toBe("unknown");
    expect(m.unverified[0]?.cve).toBe("CVE-2024-24919");
    expect(m.unverified[0]?.noteJa).toContain("Jumbo Hotfix");
  });
  it("KEV に項目の無い製品（ヤマハ）は unknown で「KEV にない」と言う", () => {
    const m = matchKev({ product: "ヤマハ RTX1210", version: "14.01.42" }, catalog, table);
    expect(m.entries).toEqual([]);
    expect(m.versionStatus).toBe("unknown");
    expect(m.reasonJa).toContain("ありません");
  });
  it("Ivanti：22.7R2.4 は該当、22.7R2.6 は該当しない。SonicOS の末尾 n 付きビルドも比較できる", () => {
    expect(
      matchKev(
        { product: "Ivanti Connect Secure", version: "22.7R2.4" },
        catalog,
        table,
      ).matched.map((x) => x.cve),
    ).toEqual(["CVE-2025-0282", "CVE-2025-22457"]);
    expect(
      matchKev({ product: "Ivanti Connect Secure", version: "22.7R2.6" }, catalog, table)
        .versionStatus,
    ).toBe("not_affected");
    expect(
      matchKev({ product: "SonicWall TZ370", version: "7.0.1-5030" }, catalog, table).versionStatus,
    ).toBe("affected");
    expect(
      matchKev({ product: "SonicWall TZ370", version: "7.0.1-5111" }, catalog, table).versionStatus,
    ).toBe("not_affected");
    expect(
      matchKev({ product: "SonicWall TZ300", version: "6.5.4.14-109n" }, catalog, table)
        .versionStatus,
    ).toBe("affected");
  });
  it("PAN-OS：ホットフィックスの前後で該当が変わる", () => {
    const at = (v: string) => matchKev({ product: "PAN-OS", version: v }, catalog, table);
    expect(at("10.2.9").matched.map((x) => x.cve)).toEqual(["CVE-2024-3400", "CVE-2024-0012"]);
    expect(at("10.2.9-h1").matched.map((x) => x.cve)).toEqual(["CVE-2024-0012"]);
    expect(at("10.2.9-h16").versionStatus).toBe("not_affected");
    // 10.1 は 2 件とも影響なしだが、範囲表の最も古い版より古いので「該当しない」とは言わない
    expect(at("10.1.9").versionStatus).toBe("unknown");
  });
});

describe("applyKev（カルテへの反映と矛盾）", () => {
  it("該当：knownExploited / authBypass / kevCves を公開情報（external）で書く。ベンダー回答が該当なら矛盾なし", () => {
    const m = matchKev({ product: "Fortinet FortiOS", version: "7.0.14" }, catalog, table);
    const r = applyKev(demo, "vpn", m, "2026-11-03T00:00:00.000Z");
    const vpn = r.profile.assets.find((a) => a.id === "vpn");
    expect(vpn?.attrs).toMatchObject({
      knownExploited: true,
      authBypass: true,
      kevCves: "CVE-2024-55591,CVE-2025-24472",
      kevCatalogVersion: "2026.10.30",
      kevCheckedAt: "2026-11-03T00:00:00.000Z",
    });
    expect(vpn?.attrEvidence.knownExploited).toBe("external");
    expect(vpn?.attrEvidence.authBypass).toBe("external");
    expect(r.contradictions).toEqual([]);
    // 元のカルテは変えない
    expect(demo.assets.find((a) => a.id === "vpn")?.attrEvidence.knownExploited).toBe("vendor");
  });
  it("該当しない：knownExploited を false に上書きし、ベンダー回答の「該当」との食い違いを矛盾として返す。前回 KEV が書いた属性は消す", () => {
    const first = applyKev(
      demo,
      "vpn",
      matchKev({ product: "Fortinet FortiOS", version: "7.0.14" }, catalog, table),
    ).profile;
    const m = matchKev({ product: "Fortinet FortiOS", version: "7.0.17" }, catalog, table);
    const r = applyKev(first, "vpn", m);
    const vpn = r.profile.assets.find((a) => a.id === "vpn");
    expect(vpn?.attrs.knownExploited).toBe(false);
    expect(vpn?.attrEvidence.knownExploited).toBe("external");
    expect(vpn?.attrs.kevCves).toBeUndefined();
    expect(vpn?.attrs.authBypass).toBeUndefined();
    expect(r.changed).toEqual(expect.arrayContaining(["knownExploited", "kevCves", "authBypass"]));
    // 1 回目の反映で根拠が external になっているので矛盾は出ない
    expect(r.contradictions).toEqual([]);
    // 元のデモ精工（ベンダー回答で該当）から直接「該当しない」に行くと矛盾
    const direct = applyKev(demo, "vpn", m);
    expect(direct.contradictions).toHaveLength(1);
    expect(direct.contradictions[0]?.external).toContain("該当しない");
    expect(direct.contradictions[0]?.registered).toContain("ベンダー回答：該当");
  });
  it("担当者登録の「該当しない」に公開情報の「該当」が重なると矛盾になり、公開情報で上書きする", () => {
    const p: CompanyProfile = structuredClone(demo);
    const vpn = p.assets.find((a) => a.id === "vpn");
    if (!vpn) throw new Error("vpn");
    vpn.attrs.knownExploited = false;
    vpn.attrEvidence.knownExploited = "registered";
    const r = applyKev(
      p,
      "vpn",
      matchKev({ product: "FortiOS", version: "7.0.14" }, catalog, table),
    );
    expect(r.profile.assets.find((a) => a.id === "vpn")?.attrs.knownExploited).toBe(true);
    expect(r.contradictions).toHaveLength(1);
    expect(r.contradictions[0]?.registered).toBe("担当者登録：該当しない");
    expect(r.contradictions[0]?.messageJa).toContain("CVE-2024-55591");
  });
  it("unknown なら何も変えない", () => {
    const r = applyKev(demo, "vpn", matchKev({ product: "FortiOS" }, catalog, table));
    expect(r.changed).toEqual([]);
    expect(r.profile).toEqual(demo);
  });
  it("authBypass が不明な CVE だけに該当したときは authBypass を書かない", () => {
    const sophosOnly: KevCatalog = { ...catalog, vulnerabilities: [] };
    const m = matchKev({ product: "Sophos Firewall", version: "19.0.1" }, sophosOnly, table);
    // 19.0.1 は CVE-2022-3236（authBypass 未記載）だけに該当し、CVE-2022-1040（〜18.5.3）には該当しない
    expect(m.matched.map((x) => x.cve)).toEqual(["CVE-2022-3236"]);
    const r = applyKev(demo, "vpn", m);
    const vpn = r.profile.assets.find((a) => a.id === "vpn");
    expect(vpn?.attrs.knownExploited).toBe(true);
    // デモ精工のベンダー回答の authBypass はそのまま残る（KEV は触らない）
    expect(vpn?.attrEvidence.authBypass).toBe("vendor");
  });
});
