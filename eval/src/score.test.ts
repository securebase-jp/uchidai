import { describe, expect, it } from "vitest";
import { matchSteps, normalizeText, quoteSupports, scoreCase } from "./score.ts";
import type { GoldCase, GoldStep, Recording } from "./types.ts";

const entryStep: GoldStep = {
  label: "入口",
  tactic: "TA0001",
  techniques: ["T1190"],
  source: "stated",
  quoteHint: "VPN装置の脆弱性",
};

const gold: GoldCase = {
  id: "sample",
  title: "採点のテスト用",
  status: "confirmed",
  source: { citation: "テスト", url: "https://example.com/", summary: "テスト用" },
  expected: {
    damageType: "ransomware",
    clarity: "partial",
    usedInDemo: true,
    verdict: "breached",
    steps: [
      entryStep,
      { label: "権限", tactic: "TA0006", techniques: ["T1003"], source: "inferred" },
      { label: "暗号化", tactic: "TA0040", techniques: ["T1486"], source: "stated" },
    ],
  },
};

const rec = (steps: Recording["output"]["steps"], verdict?: Recording["verdict"]): Recording => ({
  caseId: "sample",
  mode: "with-knowledge",
  model: "test",
  recordedAt: "2026-11-02T00:00:00Z",
  output: { damageType: "ransomware", clarity: "partial", steps },
  ...(verdict ? { verdict } : {}),
});

describe("normalizeText", () => {
  it("空白・全角半角・引用符の揺れを吸収する", () => {
    expect(normalizeText("ＶＰＮ 装置の「脆弱性」。")).toBe("VPN装置の脆弱性");
  });
});

describe("matchSteps", () => {
  it("同じ戦術の段階を順に割り当て、同じ出力段階を二度使わない", () => {
    const m = matchSteps(gold.expected.steps, [
      { tactic: "TA0040", techniques: ["T1486"], source: "stated" },
      { tactic: "TA0001", techniques: ["T1190"], source: "stated" },
    ]);
    expect(m[0]?.techniques).toEqual(["T1190"]);
    expect(m[1]).toBeUndefined();
    expect(m[2]?.techniques).toEqual(["T1486"]);
  });
  it("同じ戦術の段階が複数あるときは、手法が一致するものを優先して割り当てる", () => {
    const g: GoldStep[] = [
      { label: "バックアップ", tactic: "TA0040", techniques: ["T1490"], source: "stated" },
      { label: "暗号化", tactic: "TA0040", techniques: ["T1486"], source: "stated" },
    ];
    const m = matchSteps(g, [
      { tactic: "TA0040", techniques: ["T1486"], source: "stated" },
      { tactic: "TA0040", techniques: ["T1490"], source: "stated" },
    ]);
    expect(m[0]?.techniques).toEqual(["T1490"]);
    expect(m[1]?.techniques).toEqual(["T1486"]);
  });
});

describe("quoteSupports", () => {
  const article =
    "被害企業では、VPN装置の脆弱性を悪用されて侵入された。その後、業務システムが暗号化された。";
  const g = entryStep;
  it("原文に実在し、手がかりを含むなら 1", () => {
    expect(
      quoteSupports(
        {
          tactic: "TA0001",
          techniques: [],
          source: "stated",
          quote: "VPN装置の脆弱性を悪用されて侵入された",
        },
        g,
        article,
      ),
    ).toBe(1);
  });
  it("原文にない文は 0（捏造の検出）", () => {
    expect(
      quoteSupports(
        { tactic: "TA0001", techniques: [], source: "stated", quote: "多要素認証が未設定だった" },
        g,
        article,
      ),
    ).toBe(0);
  });
  it("原文にはあるが段階を支えない文は 0", () => {
    expect(
      quoteSupports(
        {
          tactic: "TA0001",
          techniques: [],
          source: "stated",
          quote: "業務システムが暗号化された。",
        },
        g,
        article,
      ),
    ).toBe(0);
  });
});

describe("scoreCase", () => {
  it("完全一致なら全観点 100%", () => {
    const s = scoreCase(
      gold,
      rec(
        [
          {
            tactic: "TA0001",
            techniques: ["T1190"],
            source: "stated",
            quote: "VPN装置の脆弱性を悪用",
          },
          { tactic: "TA0006", techniques: ["T1003"], source: "inferred" },
          {
            tactic: "TA0040",
            techniques: ["T1486"],
            source: "stated",
            quote: "業務システムが暗号化",
          },
        ],
        "breached",
      ),
      { articleText: "VPN装置の脆弱性を悪用された。業務システムが暗号化された。" },
    );
    expect(s.stageRecall).toBe(1);
    expect(s.sourceAccuracy).toBe(1);
    expect(s.techniqueScore).toBe(1);
    expect(s.quoteScore).toBe(1);
    expect(s.verdictMatch).toBe(1);
    expect(s.overall).toBe(1);
  });

  it("段階の欠落・区別の誤り・戦術のみ一致を部分点にする", () => {
    const s = scoreCase(
      gold,
      rec([
        { tactic: "TA0001", techniques: ["T1133"], source: "inferred" },
        { tactic: "TA0040", techniques: ["T1486"], source: "stated" },
      ]),
    );
    expect(s.stageRecall).toBeCloseTo(2 / 3);
    expect(s.sourceAccuracy).toBeCloseTo(1 / 2);
    expect(s.techniqueScore).toBeCloseTo((0.5 + 1) / 3);
    expect(s.quoteScore).toBeNull();
    expect(s.verdictMatch).toBeNull();
  });

  it("親手法のみ一致は 0.75", () => {
    const g2: GoldCase = {
      ...gold,
      expected: {
        ...gold.expected,
        steps: [{ label: "x", tactic: "TA0001", techniques: ["T1566.001"], source: "stated" }],
      },
    };
    const s = scoreCase(g2, rec([{ tactic: "TA0001", techniques: ["T1566"], source: "stated" }]));
    expect(s.techniqueScore).toBe(0.75);
  });
});
