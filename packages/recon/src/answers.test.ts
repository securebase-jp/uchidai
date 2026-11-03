import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CompanyProfile, type ProfileAnswers } from "@uchidai/engine";
import { describe, expect, it } from "vitest";
import { applyAssetHints, mergeAnswers, reconToAnswers, reconToAssetHints } from "./answers.ts";
import { repoRoot } from "./cache.ts";
import { fixtureSources, loadDemoFixture } from "./fixture.ts";
import { verifyOwnership } from "./ownership.ts";
import { recon } from "./recon.ts";

const fixture = loadDemoFixture();
const { resolver, ct } = fixtureSources(fixture);
const demoProfile = CompanyProfile.parse(
  JSON.parse(readFileSync(join(repoRoot, "examples", "demo-seiko.json"), "utf8")),
);

async function result() {
  const check = await verifyOwnership(fixture.domain, fixture.verificationToken ?? "", {
    resolver,
  });
  if (!check.ok) throw new Error(check.reasonJa);
  return recon(fixture.domain, {
    ownership: check.verified,
    resolver,
    ct,
    now: () => new Date("2026-11-02T09:00:00Z"),
  });
}

describe("reconToAnswers", () => {
  it("メールはクラウド、ホームページはレンタルサーバ、社外接続に VPN を含める", async () => {
    const hints = reconToAnswers(await result());
    expect(hints.answers.hosting).toEqual({ mail: "cloud", web: "provider" });
    expect(hints.answers.remoteAccess).toEqual(["vpn"]);
    expect(hints.inferred).toEqual(["hosting.mail", "hosting.web", "remoteAccess"]);
    expect(hints.reasonsJa["hosting.mail"]).toContain("Microsoft 365");
    expect(hints.reasonsJa.remoteAccess).toContain("vpn.demo-seiko.example");
  });
  it("デモ用カルテの回答と矛盾しない", async () => {
    const hints = reconToAnswers(await result());
    const answers = demoProfile.answers;
    expect(answers?.hosting.mail).toBe(hints.answers.hosting.mail);
    expect(answers?.hosting.web).toBe(hints.answers.hosting.web);
    expect(answers?.remoteAccess).toContain("vpn");
  });
});

describe("mergeAnswers", () => {
  const blank: ProfileAnswers = {
    industry: "manufacturing",
    site: "factory",
    hosting: { mail: "unknown", files: "unknown", core: "unknown", web: "unknown" },
    remoteAccess: ["unknown"],
    backup: "unknown",
  };
  it("未回答（unknown）の項目にだけ推定値を入れる", async () => {
    const hints = reconToAnswers(await result());
    const { answers, applied } = mergeAnswers(blank, hints);
    expect(answers.hosting.mail).toBe("cloud");
    expect(answers.hosting.web).toBe("provider");
    expect(answers.hosting.files).toBe("unknown");
    expect(answers.remoteAccess).toEqual(["vpn"]);
    expect(applied).toEqual(["hosting.mail", "hosting.web", "remoteAccess"]);
  });
  it("担当者が答えた値は上書きせず、社外接続は足すだけ", async () => {
    const hints = reconToAnswers(await result());
    const answered: ProfileAnswers = {
      ...blank,
      hosting: { ...blank.hosting, mail: "onprem" },
      remoteAccess: ["vendor_remote"],
    };
    const { answers, applied } = mergeAnswers(answered, hints);
    expect(answers.hosting.mail).toBe("onprem");
    expect(answers.remoteAccess).toEqual(["vendor_remote", "vpn"]);
    expect(applied).toEqual(["hosting.web", "remoteAccess"]);
  });
});

describe("reconToAssetHints / applyAssetHints", () => {
  it("VPN 装置に exposed（external）と M1042 なし、クラウドメールに spf/dmarc を当てる", async () => {
    const hints = reconToAssetHints(await result());
    const vpn = hints.find((h) => h.role === "entry.vpn");
    expect(vpn?.attrs).toEqual({ exposed: true, hostname: "vpn.demo-seiko.example" });
    expect(vpn?.attrEvidence.exposed).toBe("external");
    expect(vpn?.controls[0]).toMatchObject({
      mitigation: "M1042",
      status: "absent",
      evidence: "external",
    });
    const mail = hints.find((h) => h.role === "cloud.mail");
    expect(mail?.attrs).toMatchObject({ spf: true, dmarc: false, mailProvider: "Microsoft 365" });
    expect(mail?.attrEvidence).toMatchObject({ spf: "external", dmarc: "external" });
    const web = hints.find((h) => h.role === "entry.web");
    expect(web?.attrs.hostingProvider).toBe("さくらインターネット");
    expect(hints.some((h) => h.role === "entry.rdp")).toBe(false);
  });
  it("カルテに重ねると、役割が一致する資産だけが更新され、既存の値と整合する", async () => {
    const hints = reconToAssetHints(await result());
    const updated = applyAssetHints(demoProfile, hints);
    expect(CompanyProfile.parse(updated)).toEqual(updated);
    const vpn = updated.assets.find((a) => a.id === "vpn");
    expect(vpn?.attrs.exposed).toBe(true);
    expect(vpn?.attrs.hostname).toBe("vpn.demo-seiko.example");
    expect(vpn?.attrs.knownExploited).toBe(true);
    expect(vpn?.controls.filter((c) => c.mitigation === "M1042")).toHaveLength(1);
    expect(vpn?.controls.find((c) => c.mitigation === "M1051")?.status).toBe("absent");
    const mail = updated.assets.find((a) => a.id === "cloud-mail");
    expect(mail?.attrs).toMatchObject({ spf: true, dmarc: false, mfaMethod: "app" });
    expect(updated.assets.find((a) => a.id === "core")).toEqual(
      demoProfile.assets.find((a) => a.id === "core"),
    );
  });
});

describe("applyAssetHints と廃止済みの資産", () => {
  it("廃止済み（decommissioned）の資産には属性を重ねない（残っている名前は矛盾として扱う）", async () => {
    const hints = reconToAssetHints(await result());
    expect(hints.some((h) => h.role === "entry.web")).toBe(true);
    const updated = applyAssetHints(demoProfile, hints);
    const campaign = updated.assets.find((a) => a.id === "campaign-site");
    const before = demoProfile.assets.find((a) => a.id === "campaign-site");
    expect(campaign?.attrs).toEqual(before?.attrs);
    expect(campaign?.attrEvidence).toEqual(before?.attrEvidence);
  });
});

describe("applyAssetHints と根拠の優先順位", () => {
  it("担当者登録・ベンダー回答の緩和策は残し、前回の外部確認の記録だけを置き換える（矛盾は engine が拾う）", async () => {
    const hints = reconToAssetHints(await result());
    const registered: CompanyProfile = {
      ...demoProfile,
      assets: demoProfile.assets.map((a) =>
        a.id === "vpn"
          ? {
              ...a,
              controls: [
                {
                  mitigation: "M1042",
                  status: "present",
                  evidence: "registered",
                  noteJa: "非公開のつもり",
                },
                {
                  mitigation: "M1042",
                  status: "present",
                  evidence: "external",
                  noteJa: "古い外部確認",
                },
              ],
            }
          : a,
      ),
    };
    const updated = applyAssetHints(registered, hints);
    const vpn = updated.assets.find((a) => a.id === "vpn");
    const m1042 = vpn?.controls.filter((c) => c.mitigation === "M1042") ?? [];
    expect(m1042).toHaveLength(2);
    expect(m1042.map((c) => c.evidence).sort()).toEqual(["external", "registered"]);
    expect(m1042.find((c) => c.evidence === "external")?.status).toBe("absent");
    expect(m1042.find((c) => c.evidence === "registered")?.status).toBe("present");
  });
});

describe("applyAssetHints と外部確認の名前の突き合わせ（external を渡したとき）", () => {
  it("廃止済みの資産に externallySeen / externallySeenAt / lastCertExpiry を根拠 external で付ける", async () => {
    const r = await result();
    const updated = applyAssetHints(demoProfile, reconToAssetHints(r), r);
    const campaign = updated.assets.find((a) => a.id === "campaign-site");
    expect(campaign?.attrs).toMatchObject({
      decommissioned: true,
      hostname: "campaign2019.demo-seiko.example",
      externallySeen: true,
      externallySeenAt: r.checkedAt,
      lastCertExpiry: "2019-07-30T23:59:59Z",
    });
    expect(campaign?.attrEvidence).toMatchObject({
      externallySeen: "external",
      externallySeenAt: "external",
      lastCertExpiry: "external",
    });
    // 役割（entry.web）の属性は廃止済みの資産には重ねない
    expect(campaign?.attrs.exposed).toBeUndefined();
    expect(campaign?.attrs.hostingProvider).toBeUndefined();
    expect(CompanyProfile.parse(updated)).toEqual(updated);
  });
  it("外部に残っていない廃止済みの資産には externallySeen: false を付け、ホスト名の無い資産には何も付けない", async () => {
    const r = await result();
    const gone = {
      id: "old-shop",
      kind: "system" as const,
      role: "entry.web",
      label: "旧通販サイト",
      attrs: { decommissioned: true, hostname: "shop2015.demo-seiko.example" },
      attrEvidence: { decommissioned: "registered" as const, hostname: "registered" as const },
      controls: [],
    };
    const noName = {
      ...gone,
      id: "old-file",
      label: "旧ファイルサーバ",
      attrs: { decommissioned: true },
      attrEvidence: { decommissioned: "registered" as const },
    };
    const profile = { ...demoProfile, assets: [...demoProfile.assets, gone, noName] };
    const updated = applyAssetHints(profile, reconToAssetHints(r), r);
    const shop = updated.assets.find((a) => a.id === "old-shop");
    expect(shop?.attrs).toEqual({
      decommissioned: true,
      hostname: "shop2015.demo-seiko.example",
      externallySeen: false,
      externallySeenAt: r.checkedAt,
    });
    expect(shop?.attrEvidence.externallySeen).toBe("external");
    expect(updated.assets.find((a) => a.id === "old-file")).toEqual(noName);
  });
  it("前回の外部確認の値（根拠 external）は付け直し、担当者が登録した値は残す", async () => {
    const r = await result();
    const profile = {
      ...demoProfile,
      assets: demoProfile.assets.map((a) =>
        a.id === "campaign-site"
          ? {
              ...a,
              attrs: { ...a.attrs, externallySeen: false, lastCertExpiry: "2000-01-01T00:00:00Z" },
              attrEvidence: {
                ...a.attrEvidence,
                externallySeen: "external" as const,
                lastCertExpiry: "registered" as const,
              },
            }
          : a,
      ),
    };
    const updated = applyAssetHints(profile, reconToAssetHints(r), r);
    const campaign = updated.assets.find((a) => a.id === "campaign-site");
    expect(campaign?.attrs.externallySeen).toBe(true);
    // 担当者登録の lastCertExpiry は外部確認で上書きされる（属性は 1 値。根拠は external に）
    expect(campaign?.attrs.lastCertExpiry).toBe("2019-07-30T23:59:59Z");
    expect(campaign?.attrEvidence.lastCertExpiry).toBe("external");
  });
  it("現役の資産には、ホスト名に当たる証明書の最後の期限（certExpiry）を付ける", async () => {
    const r = await result();
    const updated = applyAssetHints(demoProfile, reconToAssetHints(r), r);
    const vpn = updated.assets.find((a) => a.id === "vpn");
    expect(vpn?.attrs.certExpiry).toBe("2027-03-31T23:59:59Z");
    expect(vpn?.attrEvidence.certExpiry).toBe("external");
    expect(vpn?.attrs.certWildcard).toBeUndefined();
    // ホスト名の登録が無い資産には付かない
    const core = updated.assets.find((a) => a.id === "core");
    expect(core?.attrs.certExpiry).toBeUndefined();
  });
  it("同じ名前の証明書が無く親のワイルドカードだけなら certWildcard: true を添える", async () => {
    const r = await result();
    const intranet = {
      id: "intranet",
      kind: "system" as const,
      role: "server",
      label: "社内ポータル",
      attrs: { hostname: "portal.demo-seiko.example" },
      attrEvidence: { hostname: "registered" as const },
      controls: [],
    };
    const profile = { ...demoProfile, assets: [...demoProfile.assets, intranet] };
    const updated = applyAssetHints(profile, reconToAssetHints(r), r);
    const portal = updated.assets.find((a) => a.id === "intranet");
    expect(portal?.attrs).toMatchObject({ certExpiry: "2025-01-01T23:59:59Z", certWildcard: true });
    expect(portal?.attrEvidence).toMatchObject({
      certExpiry: "external",
      certWildcard: "external",
    });
  });
  it("external を渡さなければ、証明書と廃止済みの属性は付かない（従来どおり）", async () => {
    const r = await result();
    const updated = applyAssetHints(demoProfile, reconToAssetHints(r));
    expect(updated.assets.find((a) => a.id === "vpn")?.attrs.certExpiry).toBeUndefined();
    expect(
      updated.assets.find((a) => a.id === "campaign-site")?.attrs.externallySeen,
    ).toBeUndefined();
  });
});

describe("applyAssetHints のドメインの付け替え", () => {
  it("外部確認のドメインがカルテと違えば、廃止済み資産の残存をその名前で突き合わせ、カルテのホスト名も更新する", () => {
    const profile: CompanyProfile = {
      id: "p",
      companyName: "テスト",
      fictional: false,
      domain: "demo-seiko.example",
      domainVerified: false,
      pattern: "manufacturing",
      assets: [
        {
          id: "old",
          kind: "system",
          role: "entry.web",
          label: "旧サイト",
          attrs: { decommissioned: true, hostname: "campaign2019.demo-seiko.example" },
          attrEvidence: { decommissioned: "registered", hostname: "registered" },
          controls: [],
        },
      ],
      businesses: [],
      personalData: [],
    };
    const next = applyAssetHints(profile, [], {
      domain: "exe-com.com",
      checkedAt: "2026-11-03T00:00:00Z",
      hostnames: [
        {
          name: "campaign2019.exe-com.com",
          resolves: true,
          addresses: ["203.0.113.82"],
          certCount: 1,
          activeCertCount: 0,
          lastExpiry: "2019-07-30T00:00:00Z",
          wildcard: false,
        } as never,
      ],
    });
    const old = next.assets[0];
    expect(old?.attrs.externallySeen).toBe(true);
    expect(old?.attrs.hostname).toBe("campaign2019.exe-com.com");
    expect(old?.attrEvidence.hostname).toBe("registered");
  });
});
