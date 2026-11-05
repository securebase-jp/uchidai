import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type Asset, CompanyProfile } from "@uchidai/engine";
import { describe, expect, it } from "vitest";
import { repoRoot } from "./cache.ts";
import { findContradictions } from "./contradictions.ts";
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

const campaign: Asset = {
  id: "old-campaign",
  kind: "system",
  role: "entry.web",
  label: "旧キャンペーンサイト（2019 年）",
  attrs: { decommissioned: true, hostname: "campaign2019.demo-seiko.example" },
  attrEvidence: { decommissioned: "registered", hostname: "registered" },
  controls: [],
};

/** デモ用カルテには廃止済みサイト（campaign-site）が入っているので、矛盾の単体テストでは外して使う */
const baseProfile = {
  ...demoProfile,
  assets: demoProfile.assets.filter((a) => a.id !== "campaign-site"),
};

function withAssets(...extra: Asset[]) {
  return { ...baseProfile, assets: [...baseProfile.assets, ...extra] };
}

describe("findContradictions", () => {
  it("デモ用カルテの廃止済みサイトは、fixture の DNS に残っているので矛盾として出る", async () => {
    const out = findContradictions(await result(), demoProfile);
    expect(out.map((c) => c.assetId)).toEqual(["campaign-site"]);
  });
  it("デモ用カルテそのままでは矛盾なし（外部確認と整合）", async () => {
    expect(findContradictions(await result(), baseProfile)).toEqual([]);
  });

  it("廃止済みのホスト名が DNS に残っていれば矛盾", async () => {
    const out = findContradictions(await result(), withAssets(campaign));
    expect(out).toHaveLength(1);
    expect(out[0]?.assetId).toBe("old-campaign");
    expect(out[0]?.messageJa).toContain("campaign2019.demo-seiko.example");
    expect(out[0]?.external).toContain("203.0.113.82");
    expect(out[0]?.external).toContain("過去に証明書が発行");
    expect(out[0]?.registered).toContain("廃止済み");
  });

  it("廃止済みでも外部に痕跡がなければ矛盾にしない", async () => {
    const gone: Asset = {
      ...campaign,
      id: "gone",
      attrs: { decommissioned: true, hostname: "oldshop.demo-seiko.example" },
    };
    expect(findContradictions(await result(), withAssets(gone))).toEqual([]);
  });

  it("「非公開」（M1042 present、登録由来）なのに VPN 用ホスト名があれば矛盾", async () => {
    const profile = {
      ...baseProfile,
      assets: baseProfile.assets.map((a) =>
        a.id === "vpn"
          ? {
              ...a,
              controls: a.controls.map((c) =>
                c.mitigation === "M1042"
                  ? { ...c, status: "present" as const, evidence: "registered" as const }
                  : c,
              ),
            }
          : a,
      ),
    };
    const out = findContradictions(await result(), profile);
    expect(out).toHaveLength(1);
    expect(out[0]?.assetId).toBe("vpn");
    expect(out[0]?.messageJa).toContain("非公開");
    expect(out[0]?.external).toContain("vpn.demo-seiko.example");
  });

  it("exposed = false（登録由来）も矛盾になる。external 由来なら矛盾にしない", async () => {
    const make = (evidence: "registered" | "external") => ({
      ...baseProfile,
      assets: baseProfile.assets.map((a) =>
        a.id === "vpn"
          ? {
              ...a,
              attrs: { ...a.attrs, exposed: false },
              attrEvidence: { ...a.attrEvidence, exposed: evidence },
            }
          : a,
      ),
    });
    expect(findContradictions(await result(), make("registered"))).toHaveLength(1);
    expect(findContradictions(await result(), make("external"))).toHaveLength(0);
  });

  it("カルテの SPF/DMARC（登録由来）が DNS と食い違えば矛盾", async () => {
    const profile = {
      ...baseProfile,
      assets: baseProfile.assets.map((a) =>
        a.id === "cloud-mail"
          ? {
              ...a,
              attrs: { ...a.attrs, spf: false, dmarc: true },
              attrEvidence: {
                ...a.attrEvidence,
                spf: "registered" as const,
                dmarc: "registered" as const,
              },
            }
          : a,
      ),
    };
    const out = findContradictions(await result(), profile);
    expect(out.map((c) => c.registered)).toEqual(["attrs.spf = false", "attrs.dmarc = true"]);
    expect(out[0]?.external).toContain("v=spf1");
    expect(out[1]?.external).toContain("_dmarc.demo-seiko.example");
  });
});

describe("findContradictions の頑健さ", () => {
  it("attrs や controls の無い資産、hostname の無い廃止済み資産でも落ちない", async () => {
    const bare: Asset = {
      id: "bare",
      kind: "system",
      role: "entry.vpn",
      label: "名前なし",
      attrs: { decommissioned: true },
      attrEvidence: {},
      controls: [],
    };
    const out = findContradictions(await result(), withAssets(bare));
    expect(out.filter((c) => c.assetId === "bare")).toEqual([]);
  });
  it("矛盾の文は「可能性」と書き、別の正当な資産である余地を残す", async () => {
    const out = findContradictions(await result(), withAssets(campaign));
    expect(out[0]?.messageJa).toContain("可能性");
  });
});

describe("カルテのドメインと外部確認のドメインが違うとき（架空のカルテを実ドメインで試す）", () => {
  it("資産のホスト名をカルテのドメインから外部確認のドメインへ付け替えて突き合わせる", async () => {
    const r = await result();
    // 別のドメイン（example.jp）で確認した体にする（名前の末尾を付け替えた写し）
    const swapped = {
      ...r,
      domain: "example.jp",
      hostnames: r.hostnames.map((h) => ({
        ...h,
        name: h.name.replace(/demo-seiko\.example$/, "example.jp"),
      })),
    };
    const out = findContradictions(swapped, demoProfile);
    expect(out.map((c) => c.assetId)).toEqual(["campaign-site"]);
    expect(out[0]?.messageJa).toContain("campaign2019.example.jp");
  });
});
