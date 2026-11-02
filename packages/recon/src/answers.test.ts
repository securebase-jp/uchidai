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
