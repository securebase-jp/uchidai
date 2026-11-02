import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { exportFileName, exportText, parseProfileFile } from "./profile-file.ts";
import type { CompanyProfile } from "./types.ts";

const demoPath = join(import.meta.dirname, "../../../../../examples/demo-seiko.json");
const demoText = readFileSync(demoPath, "utf8");

describe("parseProfileFile（カルテ JSON の読み込み）", () => {
  it("架空企業のカルテをそのまま読め、id・fictional・$comment を保つ", () => {
    const r = parseProfileFile(demoText);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.profile.id).toBe("demo-seiko");
    expect(r.profile.fictional).toBe(true);
    expect((r.profile as unknown as { $comment?: string }).$comment).toBeDefined();
    expect(r.profile.assets.length).toBeGreaterThan(5);
  });
  it("書き出したものを読み直すと同じカルテになる", () => {
    const r = parseProfileFile(demoText);
    if (!r.ok) throw new Error(r.reasonJa);
    const again = parseProfileFile(exportText(r.profile));
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.profile).toEqual(r.profile);
  });
  it("壊れた JSON・配列・別の形は日本語の理由つきで失敗する", () => {
    const broken = parseProfileFile("{nope");
    expect(broken.ok).toBe(false);
    if (!broken.ok) expect(broken.reasonJa).toContain("JSON");
    const arr = parseProfileFile("[]");
    expect(arr.ok).toBe(false);
    if (!arr.ok) expect(arr.reasonJa).toContain("カルテの形");
    const other = parseProfileFile(JSON.stringify({ hello: "world" }));
    expect(other.ok).toBe(false);
    if (!other.ok) {
      expect(other.reasonJa).toContain("カルテの形が違います");
      expect(other.reasonJa).toContain("id");
    }
  });
  it("型の違い（status の綴り、負の日数、資産なし）を拒む", () => {
    const base = JSON.parse(demoText) as Record<string, unknown>;
    const assets = base.assets as { controls: { status: string }[] }[];
    const vpn = structuredClone(assets[0]);
    if (!vpn?.controls[0]) throw new Error("fixture");
    vpn.controls[0].status = "yes";
    const bad1 = parseProfileFile(JSON.stringify({ ...base, assets: [vpn, ...assets.slice(1)] }));
    expect(bad1.ok).toBe(false);
    if (!bad1.ok) expect(bad1.reasonJa).toContain("assets.0.controls.0.status");
    const bad2 = parseProfileFile(
      JSON.stringify({
        ...base,
        businesses: [{ id: "b", name: "x", assetIds: [], manualDays: -1, recoveryDays: 0 }],
      }),
    );
    expect(bad2.ok).toBe(false);
    const bad3 = parseProfileFile(JSON.stringify({ ...base, assets: [] }));
    expect(bad3.ok).toBe(false);
    if (!bad3.ok) expect(bad3.reasonJa).toContain("資産が 1 つもありません");
  });
  it("業務や個人情報がカルテに無い資産を指していれば拒む", () => {
    const base = JSON.parse(demoText) as { businesses: { assetIds: string[] }[] };
    const businesses = structuredClone(base.businesses);
    businesses[0]?.assetIds.push("ghost");
    const r = parseProfileFile(JSON.stringify({ ...base, businesses }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasonJa).toContain("ghost");
  });
});

describe("exportFileName", () => {
  it("会社名と日付を含み、ファイル名に使えない文字と空白を除く", () => {
    const p = { companyName: "テスト製作所 / 本社:工場?" } as CompanyProfile;
    expect(exportFileName(p, new Date(2026, 10, 2))).toBe(
      "ウチダイ-カルテ-テスト製作所本社工場-2026-11-02.json",
    );
    expect(exportFileName({ companyName: "   " } as CompanyProfile, new Date(2026, 0, 5))).toBe(
      "ウチダイ-カルテ-会社-2026-01-05.json",
    );
  });
});
