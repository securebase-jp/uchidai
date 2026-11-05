import { join } from "node:path";
import { Case, evaluate, loadKnowledge, loadProfile, repoRoot } from "@uchidai/engine";
import { describe, expect, it } from "vitest";
import {
  allowedNumbers,
  checkWriterOutput,
  formatYenInText,
  type OnePagerWriterInput,
  OnePagerWriterOutput,
  writerInputFrom,
} from "./onepager-writer.ts";

const input: OnePagerWriterInput = {
  result: "breached",
  stages: [
    { labelJa: "入口から侵入", roleJa: "VPN装置", state: "breached", source: "stated" },
    {
      labelJa: "管理者権限を奪う",
      roleJa: "管理者アカウント",
      state: "breached",
      source: "stated",
    },
    { labelJa: "暗号化・業務停止", roleJa: "中核システム", state: "breached", source: "stated" },
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
        "御社の場合は、以上の被害が見込まれます。",
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
    const est = "御社の場合は、被害が見込まれます。";
    const out = { whatHappensJa: ["復旧まで１０日かかります。", est] };
    expect(checkWriterOutput(out, input)).toBeUndefined();
    expect(checkWriterOutput({ whatHappensJa: ["復旧まで７日かかります。", est] }, input)).toMatch(
      /7/,
    );
  });
  it("止まる業務が無いのに「0日」「0 日」と書いた文は捨てる（10日や0日目は対象外）", () => {
    const none: OnePagerWriterInput = {
      ...input,
      stopped: [],
      downtimeDays: 0,
      revenueImpactJpy: undefined,
    };
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
      checkWriterOutput(
        { whatHappensJa: ["復旧まで 10 日かかります。", "御社の場合は、被害が見込まれます。"] },
        input,
      ),
    ).toBeUndefined();
  });
  it("金額は万・億の表記も許す", () => {
    const allowed = allowedNumbers({ ...input, revenueImpactJpy: 46_000_000 });
    expect(allowed.has("4600")).toBe(true);
    expect(allowed.has("46,000,000")).toBe(true);
  });
});

describe("formatYenInText（金額の書き方を読みやすくする）", () => {
  it("1 万円ちょうどの倍数は万円・億円で書く", () => {
    expect(formatYenInText("金額は3000000円です。")).toBe("金額は300万円です。");
    expect(formatYenInText("金額は3,000,000円です。")).toBe("金額は300万円です。");
    expect(formatYenInText("約15000000円")).toBe("約1,500万円");
    expect(formatYenInText("100000000円")).toBe("1億円");
    expect(formatYenInText("120000000円")).toBe("1億2,000万円");
  });
  it("端数があれば桁区切りの円、1 万円に満たなければそのまま", () => {
    expect(formatYenInText("1234567円")).toBe("1,234,567円");
    expect(formatYenInText("5000円")).toBe("5000円");
  });
  it("すでに万円・日数などは変えない", () => {
    const s = "売上への影響は140万円で、復旧まで7日かかります。1日の売上は20万円です。";
    expect(formatYenInText(s)).toBe(s);
  });
});

describe("段階の確認状況（source）に合わない言い方を捨てる（TRIAL-001・005）", () => {
  const stage = (
    source: "stated" | "inferred" | "candidate",
    state: "breached" | "unknown" | "blocked" = "breached",
  ) => ({ labelJa: "段階", roleJa: "役割", state, source });
  const base: OnePagerWriterInput = {
    ...input,
    stages: [],
    stopped: [],
    downtimeDays: 0,
    revenueImpactJpy: undefined,
  };
  const lines = (...l: string[]) => ({ whatHappensJa: l });

  it("記載（stated）の段階を「確認が取れていません」と書いた文は捨てる", () => {
    const i = { ...base, stages: [stage("stated")] };
    for (const line of [
      "データの持ち出しは確認が取れていません。",
      "データの持ち出しは確認できていません。",
      "データの持ち出しは確認されていません。",
    ])
      expect(checkWriterOutput(lines(line), i), line).toMatch(/確認が取れていません/);
    expect(checkWriterOutput(lines("データの持ち出しは確認されています。"), i)).toBeUndefined();
  });
  it("記載の段階があるとき、「不明」も捨てる", () => {
    const i = { ...base, stages: [stage("stated")] };
    expect(checkWriterOutput(lines("持ち出しの有無は不明です。"), i)).toMatch(/不明/);
  });
  it("推定（inferred）の段階を断定した文は捨て、「考えられます」なら通す", () => {
    const i = { ...base, stages: [stage("inferred")] };
    expect(checkWriterOutput(lines("バックアップも消されます。"), i)).toMatch(/断定/);
    expect(checkWriterOutput(lines("バックアップも消されたと考えられます。"), i)).toBeUndefined();
    expect(checkWriterOutput(lines("バックアップも消されるおそれがあります。"), i)).toBeUndefined();
  });
  it("入口が候補（candidate）なら「入口はまだ分かっていません」が要る", () => {
    const i = { ...base, stages: [stage("candidate"), stage("inferred")] };
    expect(checkWriterOutput(lines("VPN装置から入られ、暗号化されると考えられます。"), i)).toMatch(
      /入口が候補/,
    );
    expect(
      checkWriterOutput(
        lines(
          "入口はまだ分かっていません。たとえばVPN装置から入られた場合は、暗号化されると考えられます。",
        ),
        i,
      ),
    ).toBeUndefined();
  });
  it("state が unknown の段階は固定の言い回しで書く（攻撃が起きたかの話に使わない）", () => {
    const i = { ...base, stages: [stage("stated", "unknown")] };
    expect(checkWriterOutput(lines("管理者権限が奪われました。"), i)).toMatch(/止める対策/);
    expect(
      checkWriterOutput(
        lines("管理者権限が奪われました。この段階を止める対策が確認できていません。"),
        i,
      ),
    ).toBeUndefined();
  });
});

describe("writerInputFrom は各段階の source を渡す", () => {
  const k = loadKnowledge();
  it("入口が不明の記事では最初の段階が candidate、記載の段階は stated", () => {
    const theCase = Case.parse({
      id: "t",
      title: "t",
      damageType: "ransomware",
      clarity: "unknown",
      steps: [
        {
          tactic: "TA0040",
          techniques: ["T1486"],
          summaryJa: "データが暗号化された",
          source: "stated",
          quote: "データが暗号化された",
        },
      ],
      suspiciousInstructions: [],
    });
    const profile = loadProfile(join(repoRoot, "examples", "demo-seiko.json"));
    const input2 = writerInputFrom(evaluate(theCase, profile, { knowledge: k }), k);
    expect(input2.stages[0]?.source).toBe("candidate");
    expect(input2.stages.some((s) => s.source === "stated")).toBe(true);
  });
  it("記事が入口の種類を書いているが資産は絞れないとき（正規の認証情報だけ）は、VPN装置の名前でなく入口の種類を渡す（TRIAL-I-008）", () => {
    const theCase = Case.parse({
      title: "t",
      damageType: "data_breach",
      clarity: "partial",
      steps: [
        { tactic: "TA0001", techniques: ["T1078"], source: "stated", entryKind: "credential" },
        { tactic: "TA0010", techniques: ["T1041"], source: "stated" },
      ],
      suspiciousInstructions: [],
    });
    const profile = loadProfile(join(repoRoot, "examples", "demo-seiko.json"));
    const input2 = writerInputFrom(evaluate(theCase, profile, { knowledge: k }), k);
    expect(input2.stages[0]).toMatchObject({
      roleJa: "正規の認証情報（ログイン先は不明）",
      source: "stated",
    });
    expect(JSON.stringify(input2)).not.toContain("VPN装置");
  });
});
