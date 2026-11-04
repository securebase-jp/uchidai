import { describe, expect, it } from "vitest";
import type { ControlQuestion } from "../../shared/api.ts";
import {
  answerFromChoice,
  applyStaffAnswer,
  effectiveControl,
  insuranceChoice,
  insuranceFromChoice,
  isStale,
  overwritePolicy,
  pendingCount,
  plainQuestion,
  setAssetProduct,
  setPersonalData,
  updateBusiness,
  updateCompany,
} from "./profile.ts";
import type { CompanyProfile } from "./types.ts";

const base = (): CompanyProfile => ({
  id: "from-answers",
  companyName: "テスト製作所",
  fictional: false,
  domainVerified: false,
  pattern: "manufacturing",
  assets: [
    {
      id: "vpn",
      kind: "device",
      role: "entry.vpn",
      label: "VPN装置",
      controls: [
        { mitigation: "M1051", status: "unknown", evidence: "none" },
        { mitigation: "M1042", status: "absent", evidence: "external", noteJa: "外部確認" },
        {
          mitigation: "M1032",
          status: "present",
          evidence: "vendor",
          answeredBy: "保守ベンダー",
          answeredAt: "2026-01-10T00:00:00+09:00",
        },
      ],
      attrs: {},
      attrEvidence: {},
    },
    {
      id: "backup",
      kind: "system",
      role: "backup",
      label: "バックアップ",
      controls: [{ mitigation: "M1053", status: "unknown", evidence: "none" }],
      attrs: { method: "cloud_sync", isolated: false },
      attrEvidence: { method: "registered", isolated: "registered" },
    },
  ],
  businesses: [
    { id: "biz-order", name: "受注", assetIds: ["vpn"], manualDays: 2, recoveryDays: 10 },
  ],
  personalData: [],
});

const backupQ: ControlQuestion = {
  mitigation: "M1053",
  textJa: "バックアップは切り離した保管先にありますか",
  choices: [
    {
      id: "isolated_tested",
      labelJa: "切り離した保管先があり、復旧テスト済み",
      status: "present",
      attrs: { isolated: true, restoreTested: true },
    },
    { id: "absent", labelJa: "取っていない", status: "absent" },
    { id: "unknown", labelJa: "分からない", status: "unknown" },
  ],
};

const NOW = "2026-11-02T12:00:00+09:00";

describe("applyStaffAnswer（質問の選択肢 → カルテの更新）", () => {
  it("選択肢の status と attrs を担当者登録として書き、元のカルテは変えない", () => {
    const p = base();
    const choice = backupQ.choices[0];
    if (!choice) throw new Error("選択肢がない");
    const next = applyStaffAnswer(p, answerFromChoice("backup", backupQ, choice, "担当者A", NOW));
    const c = next.assets[1]?.controls.find((x) => x.mitigation === "M1053");
    expect(c).toMatchObject({
      status: "present",
      evidence: "registered",
      noteJa: "切り離した保管先があり、復旧テスト済み",
      answeredBy: "担当者A",
      answeredAt: NOW,
    });
    expect(next.assets[1]?.attrs).toEqual({
      method: "cloud_sync",
      isolated: true,
      restoreTested: true,
    });
    expect(next.assets[1]?.attrEvidence.isolated).toBe("registered");
    expect(next.assets[1]?.attrEvidence.restoreTested).toBe("registered");
    // 元は変わらない
    expect(p.assets[1]?.controls[0]?.status).toBe("unknown");
    expect(p.assets[1]?.attrs.isolated).toBe(false);
  });
  it("「分からない」は根拠なし（none）に戻し、属性の根拠も none", () => {
    const next = applyStaffAnswer(base(), {
      assetId: "backup",
      mitigation: "M1053",
      status: "unknown",
      attrs: { isolated: true },
      answeredBy: "担当者A",
      answeredAt: NOW,
    });
    expect(next.assets[1]?.controls[0]).toMatchObject({ status: "unknown", evidence: "none" });
    expect(next.assets[1]?.attrEvidence.isolated).toBe("none");
  });
  it("カルテに無い緩和策は追加し、無い資産は例外", () => {
    const next = applyStaffAnswer(base(), {
      assetId: "vpn",
      mitigation: "M1035",
      status: "present",
      answeredBy: "担当者A",
      answeredAt: NOW,
    });
    expect(next.assets[0]?.controls.map((c) => c.mitigation)).toContain("M1035");
    expect(() =>
      applyStaffAnswer(base(), {
        assetId: "nope",
        mitigation: "M1035",
        status: "present",
        answeredBy: "担当者A",
        answeredAt: NOW,
      }),
    ).toThrow("資産 nope");
  });
  it("質問が無い緩和策は 3 択の質問になる", () => {
    const q = plainQuestion("M1018", "ユーザーアカウント管理");
    expect(q.choices.map((c) => c.status)).toEqual(["present", "absent", "unknown"]);
    expect(q.textJa).toContain("ユーザーアカウント管理");
  });
});

describe("overwritePolicy（根拠の優先順位）", () => {
  const ctl = (evidence: "external" | "vendor" | "registered" | "none", status = "present") =>
    ({ evidence, status }) as Parameters<typeof overwritePolicy>[0];
  it("外部確認は変更不可、ベンダー回答は確認、担当者登録と未確認は自由", () => {
    expect(overwritePolicy(ctl("external"), undefined)).toBe("locked_external");
    expect(overwritePolicy(ctl("vendor"), undefined)).toBe("confirm_vendor");
    expect(overwritePolicy(ctl("registered"), undefined)).toBe("free");
    expect(overwritePolicy(ctl("none", "unknown"), undefined)).toBe("free");
    expect(overwritePolicy(undefined, undefined)).toBe("free");
  });
  it("送信箱の回答がある項目は変更不可（開き直すと再適用されるため）", () => {
    expect(
      overwritePolicy(ctl("none", "unknown"), {
        assetId: "vpn",
        mitigation: "M1051",
        status: "absent",
        evidence: "vendor",
        answeredBy: "保守ベンダー",
      }),
    ).toBe("locked_outbox");
  });
  it("effectiveControl は送信箱の回答を優先して見せる", () => {
    const c = effectiveControl(
      { mitigation: "M1051", status: "unknown", evidence: "none" },
      {
        assetId: "vpn",
        mitigation: "M1051",
        status: "absent",
        evidence: "vendor",
        answeredBy: "保守ベンダー",
        answeredAt: NOW,
      },
      "M1051",
    );
    expect(c).toMatchObject({ status: "absent", evidence: "vendor", answeredBy: "保守ベンダー" });
    expect(effectiveControl(undefined, undefined, "M1051")).toEqual({
      mitigation: "M1051",
      status: "unknown",
      evidence: "none",
    });
  });
});

describe("isStale（半年経過）", () => {
  const now = new Date("2026-11-02T12:00:00+09:00");
  it("180 日より前は再確認、180 日以内と日時なし・読めない日時は促さない", () => {
    expect(isStale("2026-01-10T00:00:00+09:00", now)).toBe(true);
    expect(isStale("2026-10-01T00:00:00+09:00", now)).toBe(false);
    expect(isStale("2026-05-06T12:00:00+09:00", now)).toBe(false); // ちょうど 180 日
    expect(isStale("2026-05-05T11:59:59+09:00", now)).toBe(true);
    expect(isStale(undefined, now)).toBe(false);
    expect(isStale("いつか", now)).toBe(false);
  });
});

describe("会社・資産・業務・個人情報の更新", () => {
  it("updateCompany は数値の空を消し、保険とベンダーを置き換える", () => {
    const p = updateCompany(base(), {
      employees: 45,
      dailyRevenue: 3_000_000,
      typicalTransferJpy: Number.NaN,
      cyberInsurance: { enrolled: true, notifyWithinDays: 30 },
      vendor: { name: " 地域の保守会社 ", email: "" },
    });
    expect(p.employees).toBe(45);
    expect(p.dailyRevenue).toBe(3_000_000);
    expect("typicalTransferJpy" in p).toBe(false);
    expect(p.cyberInsurance).toEqual({ enrolled: true, notifyWithinDays: 30 });
    expect(p.vendor).toEqual({ name: "地域の保守会社" });
    const q = updateCompany(p, { employees: undefined, vendor: { name: "" }, companyName: "  " });
    expect("employees" in q).toBe(false);
    expect("vendor" in q).toBe(false);
    expect(q.companyName).toBe("テスト製作所");
  });
  it("setAssetProduct は空なら消す", () => {
    const p = setAssetProduct(base(), "vpn", " FortiGate ", "7.0.14");
    expect(p.assets[0]).toMatchObject({ product: "FortiGate", version: "7.0.14" });
    const q = setAssetProduct(p, "vpn", "", undefined);
    expect("product" in (q.assets[0] ?? {})).toBe(false);
    expect("version" in (q.assets[0] ?? {})).toBe(false);
  });
  it("updateBusiness は日数と影響先を書き、空の省略可の項目は消す", () => {
    const p = updateBusiness(base(), "biz-order", {
      manualDays: 3,
      recoveryDays: 14,
      recoveryDaysWithBackup: 2,
      affectsJa: "取引先の納期",
    });
    expect(p.businesses[0]).toMatchObject({
      manualDays: 3,
      recoveryDays: 14,
      recoveryDaysWithBackup: 2,
      affectsJa: "取引先の納期",
    });
    const q = updateBusiness(p, "biz-order", { recoveryDaysWithBackup: undefined, affectsJa: "" });
    expect("recoveryDaysWithBackup" in (q.businesses[0] ?? {})).toBe(false);
    expect("affectsJa" in (q.businesses[0] ?? {})).toBe(false);
  });
  it("setPersonalData は資産 1 つに 1 行、件数から 1,000 件超を決め、無しなら消す", () => {
    const p = setPersonalData(base(), "vpn", {
      descriptionJa: "取引先の連絡先",
      count: 3000,
      over1000: false,
      sensitive: false,
    });
    expect(p.personalData).toEqual([
      {
        assetId: "vpn",
        descriptionJa: "取引先の連絡先",
        count: 3000,
        over1000: true,
        sensitive: false,
      },
    ]);
    const q = setPersonalData(p, "vpn", {
      descriptionJa: "",
      count: undefined,
      over1000: true,
      sensitive: true,
    });
    expect(q.personalData).toEqual([
      { assetId: "vpn", descriptionJa: "個人情報", over1000: true, sensitive: true },
    ]);
    expect(setPersonalData(q, "vpn", undefined).personalData).toEqual([]);
  });
  it("pendingCount は未確認の緩和策を数える", () => {
    expect(pendingCount(base())).toBe(2);
  });
});

describe("サイバー保険の 3 択", () => {
  it("カルテ → 3 択：無ければ分からない、enrolled で加入している／していない", () => {
    expect(insuranceChoice(undefined)).toBe("unknown");
    expect(insuranceChoice({ enrolled: true })).toBe("yes");
    expect(insuranceChoice({ enrolled: false })).toBe("no");
  });
  it("3 択 → カルテ：分からないは持たない（undefined）、していないは enrolled:false、加入は通知期限を残す", () => {
    expect(insuranceFromChoice("unknown", { enrolled: true, notifyWithinDays: 7 })).toBeUndefined();
    expect(insuranceFromChoice("no", { enrolled: true, notifyWithinDays: 7 })).toEqual({
      enrolled: false,
    });
    expect(insuranceFromChoice("yes", undefined)).toEqual({ enrolled: true });
    expect(insuranceFromChoice("yes", { enrolled: true, notifyWithinDays: 7 })).toEqual({
      enrolled: true,
      notifyWithinDays: 7,
    });
    // していない → 加入に戻したとき、前の期限は引き継がない
    expect(insuranceFromChoice("yes", { enrolled: false })).toEqual({ enrolled: true });
  });
  it("分からないにするとカルテから cyberInsurance が消える", () => {
    const p = updateCompany(base(), { cyberInsurance: { enrolled: true, notifyWithinDays: 3 } });
    expect(p.cyberInsurance).toEqual({ enrolled: true, notifyWithinDays: 3 });
    const q = updateCompany(p, {
      cyberInsurance: insuranceFromChoice("unknown", p.cyberInsurance),
    });
    expect("cyberInsurance" in q).toBe(false);
  });
});
