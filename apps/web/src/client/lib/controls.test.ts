import { describe, expect, it } from "vitest";
import { resolvedControls } from "./controls.ts";
import { controlProgress, pendingCount } from "./profile.ts";
import type { CompanyProfile } from "./types.ts";

type C = CompanyProfile["assets"][number]["controls"][number];
const c = (mitigation: string, status: C["status"], evidence: C["evidence"]): C => ({
  mitigation,
  status,
  evidence,
});

describe("resolvedControls", () => {
  it("同じ緩和策は 1 件にし、確定した記録を未確認より優先する", () => {
    const r = resolvedControls([c("M1042", "unknown", "none"), c("M1042", "absent", "external")]);
    expect(r).toEqual([c("M1042", "absent", "external")]);
  });
  it("確定した記録どうしは根拠の強い方（外部確認 ＞ ベンダー ＞ 担当者登録）", () => {
    const r = resolvedControls([
      c("M1", "present", "registered"),
      c("M1", "absent", "vendor"),
      c("M1", "present", "external"),
    ]);
    expect(r).toEqual([c("M1", "present", "external")]);
  });
  it("並びは最初に現れた順で、別の緩和策は残す", () => {
    const r = resolvedControls([
      c("A", "unknown", "none"),
      c("B", "present", "registered"),
      c("A", "present", "registered"),
    ]);
    expect(r.map((x) => `${x.mitigation}:${x.status}`)).toEqual(["A:present", "B:present"]);
  });
  it("未確認の数と進み具合も、重複した記録を数えない", () => {
    const profile = {
      assets: [
        { id: "vpn", controls: [c("M1042", "unknown", "none"), c("M1042", "absent", "external")] },
      ],
    } as unknown as CompanyProfile;
    expect(pendingCount(profile)).toBe(0);
    const p = controlProgress(profile, []);
    expect(p).toMatchObject({ total: 1, unknown: 0, external: 1 });
  });
});
