/**
 * なりすましの段階で、記事が装った相手が取引先のとき、読解の検証が impersonates: partner を付ける（TRIAL-B-005）。
 * 社長・役員を装ったとき、どちらも書かれていないとき、両方書かれているときは付けない（既定の社長の言い方のまま）。
 * 判定の経路はそのまま、型紙の段階の札だけが取引先の言い方になる
 */
import { join } from "node:path";
import { evaluate, loadKnowledge, loadProfile, repoRoot } from "@uchidai/engine";
import { describe, expect, it } from "vitest";
import { verifyCase } from "./verify.ts";

const k = loadKnowledge();
const rawCase = (steps: object[]) => ({
  title: "テスト",
  damageType: "bec",
  clarity: "clear",
  steps,
  suspiciousInstructions: [],
});
const imp = (quote: string, summaryJa: string, techniques = ["T1684.001"]) => ({
  tactic: "TA0005",
  techniques,
  source: "stated",
  quote,
  summaryJa,
});
const verify = (quote: string, summaryJa: string, techniques?: string[]) =>
  verifyCase(rawCase([imp(quote, summaryJa, techniques)]), quote, k.attack);

describe("B-005：装った相手が取引先のとき", () => {
  it("取引先を装ったと書かれ、社長の語がなければ partner", () => {
    const { case: c } = verify(
      "攻撃者は取引先になりすまして、支払い先の口座の変更を依頼した。",
      "取引先を装って口座の変更を依頼した",
    );
    expect(c.steps[0]?.impersonates).toBe("partner");
  });
  it("社長・役員を装ったと書かれていれば付けない", () => {
    const { case: c } = verify(
      "攻撃者は社長になりすまして、経理担当に送金を指示した。",
      "社長を装って送金を指示した",
    );
    expect(c.steps[0]?.impersonates).toBeUndefined();
  });
  it("取引先と社長の両方の語があるとき、どちらもないときは付けない", () => {
    expect(
      verify("取引先の担当者と社長の名前を使ってなりすました。", "取引先と社長を装った").case
        .steps[0]?.impersonates,
    ).toBeUndefined();
    expect(
      verify("別人になりすまして指示した。", "なりすまして指示した").case.steps[0]?.impersonates,
    ).toBeUndefined();
  });
  it("なりすましの手法でない段階には付けない（取引先の語があっても）", () => {
    const { case: c } = verifyCase(
      rawCase([
        {
          tactic: "TA0001",
          techniques: ["T1566.002"],
          source: "stated",
          quote: "取引先を装うメールのリンクからアカウントに入られた。",
          summaryJa: "取引先を装うメール",
        },
      ]),
      "取引先を装うメールのリンクからアカウントに入られた。",
      k.attack,
    );
    expect(c.steps[0]?.impersonates).toBeUndefined();
  });
});

describe("B-005：段階の札が取引先の言い方になり、判定は変わらない", () => {
  const profile = loadProfile(join(repoRoot, "examples", "demo-seiko.json"));
  const base = {
    title: "テスト",
    damageType: "bec",
    clarity: "clear" as const,
    suspiciousInstructions: [],
  };
  const steps = (impersonates?: "partner") => [
    { tactic: "TA0001", techniques: ["T1078.004"], source: "stated" as const },
    {
      tactic: "TA0005",
      techniques: ["T1684.001"],
      source: "stated" as const,
      ...(impersonates ? { impersonates } : {}),
    },
    { tactic: "TA0040", techniques: ["T1657"], source: "stated" as const },
  ];
  it("取引先を装った事案は「取引先になりすまして指示する」、既定は「社長になりすまして指示する」", () => {
    const partner = evaluate({ ...base, steps: steps("partner") }, profile, { knowledge: k });
    const exec = evaluate({ ...base, steps: steps() }, profile, { knowledge: k });
    const labelOf = (v: typeof partner) =>
      v.paths[0]?.steps.find((s) => s.stageId === "impersonate");
    expect(labelOf(partner)?.labelJa).toBe("取引先になりすまして指示する");
    expect(labelOf(partner)?.breachedDoneJa).toBe("悪用されました");
    expect(labelOf(exec)?.labelJa).toBe("社長になりすまして指示する");
    // 判定そのものは同じ
    expect(partner.result).toBe(exec.result);
    expect(partner.paths.map((p) => p.steps.map((s) => [s.role, s.state]))).toEqual(
      exec.paths.map((p) => p.steps.map((s) => [s.role, s.state])),
    );
  });
});
