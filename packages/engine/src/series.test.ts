/**
 * 続報の系列の比較（TRIAL-I-012）：変化の判定と文は、プログラムが決定的に決める
 */
import { beforeAll, describe, expect, it } from "vitest";
import { type Knowledge, loadKnowledge } from "./knowledge.ts";
import { compareSeries, type SeriesReportInput } from "./series.ts";
import type { Case, CaseStep } from "./types.ts";

let k: Knowledge;
beforeAll(() => {
  k = loadKnowledge();
});

const caseOf = (steps: CaseStep[], extra: Partial<Case> = {}): Case => ({
  title: "t",
  damageType: "ransomware",
  clarity: "partial",
  suspiciousInstructions: [],
  steps,
  ...extra,
});
const entry = (s: Partial<CaseStep>): CaseStep => ({
  tactic: "TA0001",
  techniques: ["T1190"],
  source: "stated",
  ...s,
});
const exfil = (s: Partial<CaseStep> = {}): CaseStep => ({
  tactic: "TA0010",
  techniques: ["T1041"],
  source: "stated",
  ...s,
});
const rep = (label: string, c: Case): SeriesReportInput => ({ label, case: c });

describe("compareSeries", () => {
  const first = rep(
    "第1報",
    caseOf([
      entry({ certainty: "not_stated", source: "unknown", techniques: [] }),
      exfil({ certainty: "possible" }),
    ]),
  );
  const second = rep(
    "第2報",
    caseOf([entry({ entryKind: "vpn" }), exfil({ certainty: "confirmed" })], {
      reportedLossJpy: 50_000_000,
      leakedData: ["sensitive"],
    }),
  );

  it("入口の「分かっていません」→「VPN 装置（記載）」、「可能性」→「確認」を、表と文で示す", () => {
    const v = compareSeries([first, second], k);
    const entryRow = v.rows.find((r) => r.tactic === "TA0001");
    expect(entryRow?.cells.map((c) => c?.textJa)).toEqual([
      "分かっていません",
      expect.stringMatching(/^VPN.*（記載）$/),
    ]);
    expect(entryRow?.changedAt).toEqual([1]);
    expect(v.rows.find((r) => r.tactic === "TA0010")?.cells.map((c) => c?.textJa)).toEqual([
      "可能性",
      "確認",
    ]);
    const t = v.transitions[0];
    expect(t?.fromLabel).toBe("第1報");
    const all = t?.changesJa.join("\n");
    expect(all).toContain("入口が「分かっていません」から「VPN");
    expect(all).toContain("が「可能性」から「確認」に変わりました");
    expect(all).toContain("被害額が約 5,000 万円と公表されました");
    expect(all).toContain("漏えいした情報に");
    expect(v.summaryJa).toHaveLength(1);
    expect(v.summaryJa[0]).toMatch(/^第2報で、/);
    expect(v.summaryJa[0]).toMatch(/。$/);
  });

  it("件数（被害額）が変わったときは前後の額を示す", () => {
    const a = rep("第1報", caseOf([entry({})], { reportedLossJpy: 10_000_000 }));
    const b = rep("第2報", caseOf([entry({})], { reportedLossJpy: 20_000_000 }));
    const v = compareSeries([a, b], k);
    expect(v.transitions[0]?.changesJa).toEqual([
      "被害額が約 1,000 万円から約 2,000 万円に変わりました",
    ]);
  });

  it("変わらない続報は、変わったところが無いと一文で言う", () => {
    const a = rep("第1報", caseOf([entry({ entryKind: "vpn" })]));
    const b = rep("第2報", caseOf([entry({ entryKind: "vpn" })]));
    const v = compareSeries([a, b], k);
    expect(v.transitions[0]?.changesJa).toEqual([]);
    expect(v.summaryJa).toEqual([
      "報の間で、攻撃の流れの確度、被害額、漏えいした情報に変わったところはありません。",
    ]);
  });

  it("段階を読み取れなかった短い続報は、比較から外し「変わった」と言わない", () => {
    const short = rep("第2報", caseOf([], { damageType: "out_of_scope", clarity: "unknown" }));
    const v = compareSeries([first, short, rep("第3報", second.case)], k);
    expect(v.reports[1]?.readable).toBe(false);
    expect(v.transitions).toHaveLength(1);
    expect(v.transitions[0]).toMatchObject({ fromLabel: "第1報", toLabel: "第3報" });
    expect(v.rows.find((r) => r.tactic === "TA0001")?.cells[1]).toBeNull();
  });

  it("推定の段階どうしの言い方の揺れは、表には出すが「変わった」とは言わない", () => {
    const inf = (certainty: CaseStep["certainty"]): CaseStep => ({
      tactic: "TA0008",
      techniques: ["T1021"],
      source: "inferred",
      certainty,
    });
    const a = rep("第1報", caseOf([entry({ entryKind: "vpn" }), inf("possible")]));
    const b = rep("第2報", caseOf([entry({ entryKind: "vpn" }), inf("confirmed")]));
    const v = compareSeries([a, b], k);
    const row = v.rows.find((r) => r.tactic === "TA0008");
    expect(row?.cells.map((c) => c?.textJa)).toEqual(["可能性（推定）", "確認（推定）"]);
    expect(row?.changedAt).toEqual([]);
    expect(v.transitions[0]?.changesJa).toEqual([]);
    // 記載（stated）に変わったときは変化として示す
    const c = rep(
      "第3報",
      caseOf([entry({ entryKind: "vpn" }), { ...inf("confirmed"), source: "stated" }]),
    );
    expect(compareSeries([b, c], k).transitions[0]?.changesJa[0]).toContain(
      "が「確認（推定）」から「確認」に変わりました",
    );
  });

  it("報が 1 件なら比較は空（文も出さない）", () => {
    const v = compareSeries([first], k);
    expect(v.transitions).toEqual([]);
    expect(v.summaryJa).toEqual([]);
  });

  it("同じ入力なら同じ出力（決定的）", () => {
    expect(JSON.stringify(compareSeries([first, second], k))).toBe(
      JSON.stringify(compareSeries([first, second], k)),
    );
  });
});
