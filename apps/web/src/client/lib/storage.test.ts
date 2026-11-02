import { describe, expect, it } from "vitest";
import { parseSavedProfile } from "./storage.ts";

const good = {
  id: "demo-seiko",
  companyName: "デモ精工株式会社",
  fictional: true,
  pattern: "manufacturing",
  assets: [
    {
      id: "vpn",
      kind: "device",
      role: "entry.vpn",
      label: "VPN装置",
      controls: [{ mitigation: "M1051", status: "absent", evidence: "vendor" }],
      attrs: { exposed: true },
      attrEvidence: { exposed: "external" },
    },
  ],
  businesses: [{ id: "b1", name: "受注", assetIds: ["vpn"], manualDays: 1, recoveryDays: 3 }],
};

describe("parseSavedProfile（localStorage の検証）", () => {
  it("正しい形はそのまま返し、知らない項目は残す", () => {
    const p = parseSavedProfile(JSON.stringify(good));
    expect(p?.id).toBe("demo-seiko");
    expect(p?.fictional).toBe(true);
  });
  it("壊れた JSON・古い形式・型違いは捨てる", () => {
    expect(parseSavedProfile(null)).toBeUndefined();
    expect(parseSavedProfile("{broken")).toBeUndefined();
    expect(parseSavedProfile("null")).toBeUndefined();
    expect(parseSavedProfile(JSON.stringify({ id: "x", companyName: "y" }))).toBeUndefined();
    expect(parseSavedProfile(JSON.stringify({ ...good, assets: "nope" }))).toBeUndefined();
    expect(parseSavedProfile(JSON.stringify({ ...good, pattern: "retail" }))).toBeUndefined();
    expect(parseSavedProfile(JSON.stringify({ ...good, assets: [{ id: "a" }] }))).toBeUndefined();
  });
});
