/**
 * 出来事の確度（certainty）：読解が stated を誤って付けても、記事の書き方の語から決定的に補正される。
 * 実記事の試験（D-002、R-001、R-002、R-004、R-007、S-003、B-007、B-011）で出た誤りを固定する。
 * 記事の本文は入れない。短い文を、テスト用に作ったもの
 */

import { join } from "node:path";
import { Case, evaluate, loadKnowledge, loadProfile, repoRoot } from "@uchidai/engine";
import { describe, expect, it } from "vitest";
import { checkWriterOutput, type OnePagerWriterInput, writerInputFrom } from "./onepager-writer.ts";
import { certaintyFromText, verifyCase } from "./verify.ts";

const k = loadKnowledge();
const article =
  "サーバが不正アクセスを受け、データが暗号化された。外部へのデータ送信の痕跡は確認されていない。" +
  "個人情報が流出した可能性がある。攻撃者は情報を窃取したと主張している。" +
  "侵入方法は明らかにされていない。クラウド上のファイルが外部から閲覧できる状態だった。";

const rawCase = (steps: object[]) => ({
  title: "テスト",
  damageType: "ransomware",
  clarity: "partial",
  steps,
  suspiciousInstructions: [],
});
const step = (o: Record<string, unknown>) => ({
  tactic: "TA0040",
  techniques: ["T1486"],
  source: "stated",
  quote: null,
  summaryJa: "データが暗号化された",
  ...o,
});
const verify = (steps: object[], opts = {}) => verifyCase(rawCase(steps), article, k.attack, opts);

describe("certaintyFromText（記事の書き方から確度を決める）", () => {
  it.each([
    [
      "外部へのデータ送信の痕跡は確認されていない。",
      "データ送信の痕跡は確認されず",
      "TA0010",
      "no_trace",
    ],
    ["個人情報が流出した可能性がある。", "個人情報が流出した", "TA0010", "possible"],
    ["情報が流出したおそれがある。", "流出した", "TA0010", "possible"],
    ["流出したとみられる。", "流出した", "TA0010", "possible"],
    ["攻撃者は情報を窃取したと主張している。", "窃取した", "TA0010", "claimed"],
    ["サーバが不正アクセスを受けた。", "侵入方法は記事に記載なし", "TA0001", "not_stated"],
    ["サーバが不正アクセスを受けた。", "侵入方法は不明", "TA0001", "not_stated"],
    [
      "クラウド上のファイルが外部から閲覧できる状態だった（アクセスの形跡は確認されていない）。",
      "閲覧できる状態",
      "TA0009",
      "exposed_only",
    ],
    ["データが暗号化された。", "データが暗号化された", "TA0040", "confirmed"],
  ] as const)("%s → %s", (quote, summary, tactic, expected) => {
    expect(certaintyFromText(quote, summary, tactic)).toBe(expected);
  });
  it("入口の段階以外の「不明」は、記載なしにしない", () => {
    expect(certaintyFromText("被害額は不明。", "被害額は不明", "TA0040")).toBe("confirmed");
  });
});

describe("verifyCase は stated を、記事の書き方に合わせて下げる", () => {
  it("R-001：「痕跡は確認されていない」持ち出しは stated にしない（no_trace）", () => {
    const { case: c, report } = verify([
      step({
        tactic: "TA0010",
        techniques: ["T1041"],
        quote: "外部へのデータ送信の痕跡は確認されていない。",
        summaryJa: "データ送信の痕跡は確認されず",
      }),
    ]);
    expect(c.steps[0]?.source).toBe("inferred");
    expect(c.steps[0]?.certainty).toBe("no_trace");
    expect(c.steps[0]?.quote).toBeDefined();
    expect(report.downgraded).toEqual([{ index: 0, certainty: "no_trace" }]);
  });
  it("D-002・S-003：「可能性」は inferred（possible）、攻撃者の主張は claimed", () => {
    const { case: c } = verify([
      step({
        tactic: "TA0010",
        techniques: ["T1041"],
        quote: "個人情報が流出した可能性がある。",
        summaryJa: "個人情報が流出した",
      }),
      step({
        tactic: "TA0010",
        techniques: ["T1041"],
        quote: "攻撃者は情報を窃取したと主張している。",
        summaryJa: "攻撃者が窃取を主張",
      }),
    ]);
    expect(c.steps.map((s) => [s.source, s.certainty])).toEqual([
      ["inferred", "possible"],
      ["inferred", "claimed"],
    ]);
  });
  it("D-002：閲覧できる状態だけの段階は exposed_only", () => {
    const { case: c } = verify([
      step({
        tactic: "TA0009",
        techniques: ["T1530"],
        quote: "クラウド上のファイルが外部から閲覧できる状態だった。",
        summaryJa: "ファイルが閲覧できる状態（取得の形跡は確認されていない）",
      }),
    ]);
    expect(c.steps[0]?.certainty).toBe("exposed_only");
    expect(c.steps[0]?.source).toBe("inferred");
  });
  it("R-002・B-007：入口の方法が「記載なし」なら、手法を外して unknown にそろえる", () => {
    const { case: c } = verify([
      step({
        tactic: "TA0001",
        techniques: ["T1190", "T1133", "T1078"],
        quote: "サーバが不正アクセスを受け",
        summaryJa: "侵入方法は記事に記載なし",
      }),
    ]);
    expect(c.steps[0]).toMatchObject({
      source: "unknown",
      techniques: [],
      certainty: "not_stated",
    });
    expect(c.steps[0]?.quote).toBeUndefined();
  });
  it("B-007：根拠文が入口の手段に触れていないフィッシングの手法は外す", () => {
    const { case: c, report } = verify([
      step({
        tactic: "TA0001",
        techniques: ["T1566.002", "T1078.004"],
        quote: "サーバが不正アクセスを受け",
        summaryJa: "不正アクセスを受けた",
      }),
    ]);
    expect(report.unsupportedEntryTechniques.map((t) => t.id)).toContain("T1566.002");
    expect(c.steps[0]?.techniques).not.toContain("T1566.002");
  });
  it("確認された出来事は stated のまま（確度の印も付けない）", () => {
    const { case: c, report } = verify([
      step({ quote: "データが暗号化された。", summaryJa: "データが暗号化された" }),
    ]);
    expect(c.steps[0]).toMatchObject({ source: "stated" });
    expect(c.steps[0]?.certainty).toBeUndefined();
    expect(report.downgraded).toEqual([]);
  });
  it("Claude が certainty を付けたときは、その確度を尊重して stated を下げる", () => {
    const { case: c } = verify([
      step({ certainty: "claimed", quote: "データが暗号化された。", summaryJa: "暗号化" }),
    ]);
    expect(c.steps[0]).toMatchObject({ source: "inferred", certainty: "claimed" });
  });
  it("B-011：根拠文がタイトルにしか無いときは、タイトルも照合し、stated にしない", () => {
    const body = verifyCase(
      rawCase([step({ quote: "取引先へ金銭被害が出た", summaryJa: "金銭被害" })]),
      article,
      k.attack,
    );
    expect(body.report.droppedQuotes.map((q) => q.reason)).toEqual(["not_in_article"]);
    const withTitle = verifyCase(
      rawCase([step({ quote: "取引先へ金銭被害が出た", summaryJa: "金銭被害" })]),
      article,
      k.attack,
      { title: "取引先へ金銭被害が出た" },
    );
    expect(withTitle.report.droppedQuotes).toEqual([]);
    expect(withTitle.report.titleOnlyQuotes).toEqual([0]);
    expect(withTitle.case.steps[0]?.source).toBe("inferred");
  });
  it("S-008・R-009：戦術と合わない手法は warnings に出る", () => {
    const { report } = verify([step({ tactic: "TA0006", techniques: ["T1078"], quote: null })]);
    expect(report.tacticMismatches.length).toBeGreaterThan(0);
    expect(report.warnings.some((w) => /戦術に合わない/.test(w))).toBe(true);
  });
});

describe("確度は判定の経路と一枚の言い換えの入力に渡る", () => {
  const profile = loadProfile(join(repoRoot, "examples", "demo-seiko.json"));
  const theCase = Case.parse({
    title: "t",
    damageType: "ransomware",
    clarity: "partial",
    suspiciousInstructions: [],
    steps: [
      { tactic: "TA0001", techniques: ["T1190"], source: "stated" },
      { tactic: "TA0010", techniques: ["T1041"], source: "inferred", certainty: "no_trace" },
      { tactic: "TA0040", techniques: ["T1486"], source: "stated" },
    ],
  });
  it("PathStep と WriterStage に certainty が入る（confirmed は省く）", () => {
    const v = evaluate(theCase, profile, { knowledge: k });
    const stages = writerInputFrom(v, k).stages;
    expect(stages.some((s) => s.certainty === "no_trace")).toBe(true);
    expect(stages.filter((s) => s.certainty === undefined).length).toBeGreaterThan(0);
  });
});

describe("一枚の言い換えの検証：確度に合わない言い方を捨てる", () => {
  const stage = (
    source: "stated" | "inferred" | "candidate",
    certainty?: "possible" | "no_trace" | "claimed" | "exposed_only",
  ) => ({
    labelJa: "段階",
    roleJa: "役割",
    state: "breached" as const,
    source,
    ...(certainty ? { certainty } : {}),
  });
  const base: OnePagerWriterInput = {
    result: "breached",
    stages: [],
    stopped: [],
    downtimeDays: 0,
    reportRequired: false,
    personalDataJa: [],
  };
  const lines = (...l: string[]) => ({ whatHappensJa: l });

  it("痕跡なしの段階：固定の言い回しが要る。「確認されています」は捨てる", () => {
    const i = { ...base, stages: [stage("stated"), stage("inferred", "no_trace")] };
    expect(checkWriterOutput(lines("侵入が確認されています。持ち出しも起きています。"), i)).toMatch(
      /痕跡は確認されていません/,
    );
    expect(
      checkWriterOutput(lines("侵入が確認されています。データ送信の痕跡は確認されていません。"), i),
    ).toBeUndefined();
  });
  it("閲覧できる状態だけ：固定の言い回し「取得されたかは確認されていません」", () => {
    const i = { ...base, stages: [stage("inferred", "exposed_only")] };
    expect(checkWriterOutput(lines("ファイルが取得されたと考えられます。"), i)).toMatch(
      /閲覧できる状態/,
    );
    expect(
      checkWriterOutput(
        lines("ファイルは閲覧できる状態でした。実際に取得されたかは確認されていません。"),
        i,
      ),
    ).toBeUndefined();
  });
  it("攻撃者の主張：「主張」と書く", () => {
    const i = { ...base, stages: [stage("stated"), stage("inferred", "claimed")] };
    expect(checkWriterOutput(lines("侵入が確認されています。情報が盗まれました。"), i)).toMatch(
      /主張/,
    );
    expect(
      checkWriterOutput(lines("侵入が確認されています。攻撃者は情報を盗んだと主張しています。"), i),
    ).toBeUndefined();
  });
  it("記事で確認された出来事が無いのに「確認されています」と書いた文は捨てる", () => {
    const i = { ...base, stages: [stage("inferred", "possible")] };
    expect(checkWriterOutput(lines("流出が確認されています。"), i)).toMatch(
      /確認された出来事が無い/,
    );
    expect(
      checkWriterOutput(lines("記事では流出の可能性があるとされています。"), i),
    ).toBeUndefined();
  });
  it("R-004：試算の文に「確認されています」を使うと捨てる。試算は「御社の場合は〜と見込まれます」", () => {
    const i: OnePagerWriterInput = {
      ...base,
      stages: [stage("stated")],
      stopped: [{ name: "受注", days: 10, manualDays: 2 }],
      downtimeDays: 10,
    };
    expect(
      checkWriterOutput(
        lines("暗号化が確認されています。受注が10日間止まることが確認されています。"),
        i,
      ),
    ).toMatch(/試算/);
    expect(checkWriterOutput(lines("暗号化が確認されています。", "受注が止まります。"), i)).toMatch(
      /御社の場合は/,
    );
    expect(
      checkWriterOutput(
        lines("暗号化が確認されています。", "御社の場合は、受注が10日間止まると見込まれます。"),
        i,
      ),
    ).toBeUndefined();
  });
});
