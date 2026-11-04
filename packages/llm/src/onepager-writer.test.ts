import { describe, expect, it } from "vitest";
import {
  allowedNumbers,
  checkWriterOutput,
  type OnePagerWriterInput,
  OnePagerWriterOutput,
} from "./onepager-writer.ts";

const input: OnePagerWriterInput = {
  result: "breached",
  stages: [
    { labelJa: "入口から侵入", roleJa: "VPN装置", state: "breached" },
    { labelJa: "管理者権限を奪う", roleJa: "管理者アカウント", state: "unknown" },
    { labelJa: "暗号化・業務停止", roleJa: "中核システム", state: "breached" },
  ],
  stopped: [{ name: "受注・生産管理", days: 10, manualDays: 2, affectsJa: "取引先の納期" }],
  downtimeDays: 10,
  partnerImpactDay: 3,
  revenueImpactJpy: 100_000_000,
  reportRequired: true,
  personalDataJa: ["取引先担当者の連絡先"],
};

describe("checkWriterOutput", () => {
  it("入力にある数値だけなら通る", () => {
    const out = OnePagerWriterOutput.parse({
      whatHappensJa: [
        "外から社内につなぐ装置から侵入され、生産管理のデータが暗号化されます。",
        "受注・生産管理が最長 10 日止まり、3 日目から取引先の納期に影響が出ます。",
        "売上への影響は約 1 億円です。",
      ],
    });
    expect(checkWriterOutput(out, input)).toBeUndefined();
  });
  it("手法 ID が混じると捨てる", () => {
    const out = { whatHappensJa: ["T1190 で侵入されます。"] };
    expect(checkWriterOutput(out, input)).toMatch(/ID/);
  });
  it("入力にない数値（期限など）を作ると捨てる", () => {
    const out = { whatHappensJa: ["5 日以内に報告が必要です。"] };
    expect(checkWriterOutput(out, input)).toMatch(/入力にない数値/);
  });
  it("全角の数字も検査する", () => {
    const out = { whatHappensJa: ["復旧まで１０日かかります。"] };
    expect(checkWriterOutput(out, input)).toBeUndefined();
    expect(checkWriterOutput({ whatHappensJa: ["復旧まで７日かかります。"] }, input)).toMatch(/7/);
  });
  it("止まる業務が無いのに「0日」「0 日」と書いた文は捨てる（10日や0日目は対象外）", () => {
    const none: OnePagerWriterInput = { ...input, stopped: [], downtimeDays: 0 };
    for (const line of [
      "復旧までの日数は0日です。",
      "復旧まで 0 日かかります。",
      "復旧までの日数は０日です。",
    ])
      expect(checkWriterOutput({ whatHappensJa: [line] }, none)).toMatch(/0日/);
    expect(
      checkWriterOutput(
        { whatHappensJa: ["業務は止まりません。個人情報の報告が必要です。"] },
        none,
      ),
    ).toBeUndefined();
    // 止まる業務があるなら対象外（その日数は入力の値で検証する）。0日目という言い方も弾かない
    expect(checkWriterOutput({ whatHappensJa: ["0日目に連絡します。"] }, none)).toBeUndefined();
    expect(
      checkWriterOutput({ whatHappensJa: ["復旧まで 10 日かかります。"] }, input),
    ).toBeUndefined();
  });
  it("金額は万・億の表記も許す", () => {
    const allowed = allowedNumbers({ ...input, revenueImpactJpy: 46_000_000 });
    expect(allowed.has("4600")).toBe(true);
    expect(allowed.has("46,000,000")).toBe(true);
  });
});
