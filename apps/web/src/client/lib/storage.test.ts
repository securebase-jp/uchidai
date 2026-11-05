import { beforeEach, describe, expect, it } from "vitest";
import { parseSavedCase, parseSavedProfile } from "./storage.ts";

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
  it("建設業の構成パターンのカルテも読める", () => {
    const p = parseSavedProfile(JSON.stringify({ ...good, pattern: "construction" }));
    expect(p?.pattern).toBe("construction");
  });
  it("壊れた JSON・古い形式・型違いは捨てる", () => {
    expect(parseSavedProfile(null)).toBeUndefined();
    expect(parseSavedProfile("{broken")).toBeUndefined();
    expect(parseSavedProfile("null")).toBeUndefined();
    expect(parseSavedProfile(JSON.stringify({ id: "x", companyName: "y" }))).toBeUndefined();
    expect(parseSavedProfile(JSON.stringify({ ...good, assets: "nope" }))).toBeUndefined();
    // 構成パターンは knowledge/profiles で増やせる。画面では形（空でない文字列）だけ見る
    expect(parseSavedProfile(JSON.stringify({ ...good, pattern: "" }))).toBeUndefined();
    expect(parseSavedProfile(JSON.stringify({ ...good, assets: [{ id: "a" }] }))).toBeUndefined();
  });
});

describe("parseSavedCase（担当者が選んだ事例の保存）", () => {
  const saved = {
    case: { title: "報道の事例", damageType: "ransomware", clarity: "clear", steps: [] },
    meta: {
      label: "報道の事例",
      sourceJa: "Claude が記事を読解",
      sourceUrl: "https://example.com/a",
    },
  };
  it("形が合えば読める。記録済みの事例の ID も残る", () => {
    expect(parseSavedCase(JSON.stringify(saved))?.meta.sourceUrl).toBe("https://example.com/a");
    const rec = {
      ...saved,
      meta: { label: "x", sourceJa: "y", recorded: { caseId: "ipa-case-1" } },
    };
    expect(parseSavedCase(JSON.stringify(rec))?.meta.recorded?.caseId).toBe("ipa-case-1");
  });
  it("複数の報を読んだ事例（series）も、保存して読み戻せる。形が違えば捨てる", () => {
    const series = {
      parts: [{ number: 1, label: "第1報" }],
      reports: [{ label: "第1報", case: { title: "t" } }],
      view: { rows: [], reports: [] },
      quoteSources: [],
    };
    const ok = parseSavedCase(JSON.stringify({ ...saved, meta: { ...saved.meta, series } }));
    expect(ok?.meta.series?.parts[0]?.label).toBe("第1報");
    expect(
      parseSavedCase(JSON.stringify({ ...saved, meta: { ...saved.meta, series: { parts: 1 } } })),
    ).toBeUndefined();
  });
  it("無い・壊れている・形が違うときは undefined", () => {
    expect(parseSavedCase(null)).toBeUndefined();
    expect(parseSavedCase("{")).toBeUndefined();
    expect(parseSavedCase(JSON.stringify({ case: { title: "t" }, meta: {} }))).toBeUndefined();
  });
});

describe("会社の「未選択に戻す」の印（localStorage）", () => {
  const mem = new Map<string, string>();
  beforeEach(() => {
    mem.clear();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
    };
  });
  it("押したら印が付き、選び直したら外れる。自社のカルテの保存には触らない", async () => {
    const { storage } = await import("./storage.ts");
    expect(storage.loadNoCompany()).toBe(false);
    mem.set("uchidai.profile.v1", "{}");
    storage.saveNoCompany();
    expect(storage.loadNoCompany()).toBe(true);
    expect(mem.has("uchidai.profile.v1")).toBe(true);
    storage.clearNoCompany();
    expect(storage.loadNoCompany()).toBe(false);
  });
});
