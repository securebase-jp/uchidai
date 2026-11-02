import { describe, expect, it } from "vitest";
import type { MeasureDef, PathStep, Verdict } from "../lib/types.ts";
import { measureEffect } from "./MeasurePanel.tsx";

const step = (role: string, extra: Partial<PathStep> = {}): PathStep => ({
  nodeId: role,
  role,
  tactic: "TA0001",
  mitigations: [],
  ineffective: [],
  source: "stated",
  state: "breached",
  evidence: "registered",
  reasonJa: "",
  ...extra,
});
const verdict: Verdict = {
  result: "breached",
  headlineJa: "",
  contradictions: [],
  timeline: [],
  attackVersion: "20.0",
  impact: { stopped: [], downtimeDays: 0, personalDataReached: [], reportRequired: false },
  paths: [
    {
      id: "p",
      source: "stated",
      reachedCore: true,
      reachedAssetIds: [],
      steps: [
        step("entry.vpn", {
          labelJa: "入口から侵入",
          mitigations: ["M1051"],
          ineffective: [{ mitigation: "M1032", reasonJa: "認証を回避するため" }],
        }),
        step("admin", { labelJa: "管理者権限を奪う", mitigations: ["M1026", "M1040"] }),
      ],
    },
    {
      id: "ai",
      source: "ai",
      reachedCore: true,
      reachedAssetIds: [],
      steps: [step("entry.vendor_remote", { mitigations: ["M1032"] })],
    },
  ],
};
const m = (id: string, mitigation: string, role: string): MeasureDef => ({
  id,
  labelJa: id,
  mitigation,
  patches: [{ role, mitigation, status: "present" }],
});

describe("measureEffect（対策ボタンの効く／効かない／経路の外）", () => {
  it("同じ役割の段階で効かない緩和策なら「効かない」と理由", () => {
    const fx = measureEffect(m("vpn-mfa", "M1032", "entry.vpn"), verdict, false);
    expect(fx.kind).toBe("ineffective");
    expect(fx.textJa).toContain("認証を回避");
  });
  it("同じ緩和策 ID でも別の役割の対策は「効かない」にしない（社長の多要素認証・保守接続）", () => {
    expect(
      measureEffect(m("exec-mfa", "M1032", "cloud.mail_account.exec"), verdict, false).kind,
    ).toBe("outside");
    // AI 経路は対策ボタンの判定に数えない
    expect(
      measureEffect(m("vendor-remote-harden", "M1032", "entry.vendor_remote"), verdict, false).kind,
    ).toBe("outside");
  });
  it("効く段階があれば段階名つき、適用中なら状態の語", () => {
    expect(measureEffect(m("vpn-update", "M1051", "entry.vpn"), verdict, false).textJa).toBe(
      "この段階に効く：入口から侵入",
    );
    expect(measureEffect(m("vpn-update", "M1051", "entry.vpn"), verdict, true).textJa).toBe(
      "適用中",
    );
  });
  it("経路の外の対策を適用中なら、外れていないことが分かる語にする", () => {
    const fx = measureEffect(m("transfer-callback", "UD-01", "person.accounting"), verdict, true);
    expect(fx.kind).toBe("applied");
    expect(fx.textJa).toContain("適用中");
  });
  it("判定が無ければ空", () => {
    expect(measureEffect(m("x", "M1051", "entry.vpn"), undefined, false).textJa).toBe("");
  });
});
