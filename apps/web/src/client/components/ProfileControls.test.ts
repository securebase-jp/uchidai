import { describe, expect, it } from "vitest";
import type { PendingItem } from "../lib/pending.ts";
import type { CompanyProfile } from "../lib/types.ts";
import { orderByPath } from "./ProfileControls.tsx";

type Asset = CompanyProfile["assets"][number];
const asset = (id: string, mitigations: string[]) =>
  ({
    id,
    kind: "system",
    role: "server",
    label: id,
    side: "internal",
    controls: mitigations.map((m) => ({ mitigation: m, status: "unknown", evidence: "none" })),
    attrs: {},
    attrEvidence: {},
  }) as unknown as Asset;
const item = (assetId: string, mitigation: string): PendingItem => ({
  assetId,
  assetLabel: assetId,
  mitigation,
  onPath: true,
});

describe("orderByPath（経路で問われている資産と行を先頭に）", () => {
  const assets = [
    asset("core", []),
    asset("server", ["M1030", "M1022"]),
    asset("vpn", ["M1051", "M1032", "M1042"]),
  ];
  it("経路の順に資産を並べ、資産の中では問われている行を先頭に。他は元の順のまま", () => {
    const out = orderByPath(assets, [item("vpn", "M1042"), item("server", "M1022")]);
    expect(out.map((a) => a.id)).toEqual(["vpn", "server", "core"]);
    expect(out[0]?.controls.map((c) => c.mitigation)).toEqual(["M1042", "M1051", "M1032"]);
    expect(out[1]?.controls.map((c) => c.mitigation)).toEqual(["M1022", "M1030"]);
  });
  it("経路の項目が無ければそのまま。元の配列は変えない", () => {
    expect(orderByPath(assets, [])).toBe(assets);
    orderByPath(assets, [item("vpn", "M1042")]);
    expect(assets.map((a) => a.id)).toEqual(["core", "server", "vpn"]);
    expect(assets[2]?.controls[0]?.mitigation).toBe("M1051");
  });
});
