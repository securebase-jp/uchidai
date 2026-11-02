import { describe, expect, it } from "vitest";
import { hostStatusLines } from "./hostStatus.ts";
import type { CompanyProfile } from "./types.ts";

type Asset = CompanyProfile["assets"][number];
const now = new Date("2026-11-03T00:00:00Z");
const asset = (
  attrs: Asset["attrs"],
  attrEvidence: Asset["attrEvidence"] = Object.fromEntries(
    Object.keys(attrs).map((k) => [k, "external"]),
  ),
): Asset => ({
  id: "a",
  kind: "system",
  role: "entry.web",
  label: "a",
  controls: [],
  attrs,
  attrEvidence,
});

describe("hostStatusLines（外部確認が付けたホスト名の状況）", () => {
  it("廃止済みで外部に残っていれば赤、最後の証明書は期限切れ", () => {
    const lines = hostStatusLines(
      asset({
        decommissioned: true,
        hostname: "campaign2019.demo-seiko.example",
        externallySeen: true,
        externallySeenAt: "2026-11-02T07:00:00Z",
        lastCertExpiry: "2019-07-30T23:59:59Z",
      }),
      now,
    );
    expect(lines.map((l) => l.tone)).toEqual(["red", "ink"]);
    expect(lines[0]?.labelJa).toBe("外部にホスト名が残っている可能性");
    expect(lines[0]?.detailJa).toContain("campaign2019.demo-seiko.example");
    expect(lines[0]?.detailJa).toContain("2026-11-02");
    expect(lines[1]?.labelJa).toBe("証明書：期限切れ（2019-07-30）");
  });
  it("廃止済みで外部に残っていなければ緑", () => {
    const lines = hostStatusLines(
      asset({
        decommissioned: true,
        hostname: "shop.example.jp",
        externallySeen: false,
        externallySeenAt: "2026-11-02T07:00:00Z",
      }),
      now,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ tone: "green", labelJa: "外部にホスト名は残っていない" });
  });
  it("根拠が external でない値は見せない", () => {
    expect(
      hostStatusLines(
        asset({ decommissioned: true, externallySeen: true }, { externallySeen: "registered" }),
        now,
      ),
    ).toEqual([]);
    expect(
      hostStatusLines(asset({ certExpiry: "2027-01-01T00:00:00Z" }, { certExpiry: "vendor" }), now),
    ).toEqual([]);
  });
  it("現役の資産：有効（期限が遠い）、30 日以内は注意、期限切れは赤", () => {
    const far = hostStatusLines(asset({ certExpiry: "2027-03-31T23:59:59Z" }), now);
    expect(far[0]).toMatchObject({ tone: "ink", labelJa: "証明書：有効（期限 2027-03-31）" });
    const soon = hostStatusLines(asset({ certExpiry: "2026-11-20T00:00:00Z" }), now);
    expect(soon[0]?.tone).toBe("amber");
    expect(soon[0]?.labelJa).toBe("証明書：期限 2026-11-20（あと 17 日）");
    const gone = hostStatusLines(asset({ certExpiry: "2025-01-01T23:59:59Z" }), now);
    expect(gone[0]).toMatchObject({ tone: "red", labelJa: "証明書：期限切れ（2025-01-01）" });
    expect(gone[0]?.detailJa).toContain("判定には使いません");
  });
  it("ワイルドカード証明書なら親の名前を添える", () => {
    const lines = hostStatusLines(
      asset({
        hostname: "portal.demo-seiko.example",
        certExpiry: "2027-01-01T00:00:00Z",
        certWildcard: true,
      }),
      now,
    );
    expect(lines[0]?.detailJa).toContain("*.demo-seiko.example");
  });
  it("属性が無ければ何も出さない", () => {
    expect(hostStatusLines(asset({ hostname: "www.example.jp" }), now)).toEqual([]);
  });
});
