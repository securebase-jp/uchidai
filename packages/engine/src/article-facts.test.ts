/** 記事が書く事実（被害額、未遂）と、御社の想定を分けて書く（TRIAL-010・016、B-003、B-013） */
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { avertedHeadline, evaluate } from "./evaluate.ts";
import { type Knowledge, loadKnowledge, loadProfile, repoRoot } from "./knowledge.ts";
import { buildOnePager } from "./onepager.ts";
import type { Case, CompanyProfile } from "./types.ts";
import { parseYenAmounts, yenAppearsIn } from "./yen.ts";

let k: Knowledge;
let demo: CompanyProfile;
beforeAll(() => {
  k = loadKnowledge();
  demo = loadProfile(join(repoRoot, "examples", "demo-seiko.json"));
});

describe("円の金額の読み取り（記事の額と照合するため。Claude に計算させない）", () => {
  it("億・万・円、カンマ、全角、「約」を扱う", () => {
    expect(parseYenAmounts("被害額は約2.56億円")).toEqual([256_000_000]);
    expect(parseYenAmounts("2億5600万円と300円")).toEqual([256_000_000, 300]);
    expect(parseYenAmounts("５，８８０万円")).toEqual([58_800_000]);
    expect(parseYenAmounts("4500万円を送金")).toEqual([45_000_000]);
    expect(parseYenAmounts("金額の記載なし")).toEqual([]);
  });
  it("誤差 1% までは一致、それ以上は不一致", () => {
    expect(yenAppearsIn(256_000_000, "約2.56億円")).toBe(true);
    expect(yenAppearsIn(260_000_000, "約2.56億円")).toBe(false);
    expect(yenAppearsIn(45_000_000, "4,500万円")).toBe(true);
  });
});

const becCase = (extra: Partial<Case> = {}): Case => ({
  title: "社長を装った送金指示",
  damageType: "bec",
  clarity: "clear",
  suspiciousInstructions: [],
  steps: [
    { tactic: "TA0001", techniques: ["T1078.004"], source: "stated" },
    { tactic: "TA0005", techniques: ["T1684.001"], source: "stated" },
  ],
  ...extra,
});

describe("B-003・TRIAL-010：記事の被害額と御社の想定額を並べる", () => {
  it("記事の額が無いときは、これまでどおり（デモの一枚が変わらない）", () => {
    const v = evaluate(becCase(), demo, { knowledge: k });
    const text = buildOnePager(v, demo, k).whatHappensJa.join("\n");
    expect(text).toContain(
      "なりすましの指示で送金すると、約 500 万円の資金が流出します（会社カルテの想定額）。",
    );
    expect(text).not.toContain("記事の事例では");
  });
  it("記事の額があれば、「記事の事例では、被害額は約 2.6 億円です。」と「御社の想定では、…約 500 万円…」を別の文で並べる", () => {
    const v = evaluate(becCase({ reportedLossJpy: 256_000_000 }), demo, { knowledge: k });
    const text = buildOnePager(v, demo, k).whatHappensJa;
    expect(text).toContain("記事の事例では、被害額は約 2.6 億円です。");
    const mine = text.find((l) => l.startsWith("御社の想定では"));
    expect(mine).toMatch(/約 500 万円の資金が流出すると見込まれます（会社カルテの想定額）/);
    // 計算には記事の額を使わない
    expect(v.impact.moneyLossJpy).toBe(demo.typicalTransferJpy);
    expect(v.article?.reportedLossJpy).toBe(256_000_000);
  });
});

describe("B-013：記事の会社が被害を防げた（未遂）", () => {
  it("一枚の最初に、防げた事例であることを書く。見出しも「記事の会社は被害を防げた事例です。同じ手口が御社に来たら、…」", () => {
    const v = evaluate(becCase({ averted: true }), demo, { knowledge: k });
    const text = buildOnePager(v, demo, k).whatHappensJa;
    expect(text[0]).toBe(
      "記事の会社は、被害を防げた事例です。以下は、同じ手口が御社に来たら、という見立てです。",
    );
    expect(v.headlineJa).toBe(avertedHeadline(v.result));
    expect(v.headlineJa).toMatch(/^記事の会社は被害を防げた事例です。同じ手口が御社に来たら、/);
  });
  it("未遂でなければ、これまでどおり。第三者の事故の見出しは書き換えない", () => {
    expect(evaluate(becCase(), demo, { knowledge: k }).headlineJa).toBe(
      "うちの会社は、大丈夫ではありませんでした",
    );
    const third = evaluate(becCase({ averted: true, victim: "vendor" }), demo, { knowledge: k });
    expect(third.headlineJa).toMatch(/^これは委託先・取引先で起きた事故です/);
  });
});

describe("TRIAL-011・D-010：一枚の文は、主語と動詞がつながる（型紙の sentenceJa）", () => {
  it("なりすまし送金：「会社の口座が起きる」でなく「会社の口座から資金が流出する」", () => {
    const v = evaluate(becCase(), demo, { knowledge: k });
    const first = buildOnePager(v, demo, k).whatHappensJa[0] ?? "";
    expect(first).toContain("会社の口座から資金が流出する");
    expect(first).not.toContain("会社の口座が起きる");
  });
  it("sentenceJa を持たない段階は、これまでどおり「{資産}が{突破されたときの言葉}」", () => {
    const v = evaluate(becCase(), demo, { knowledge: k });
    expect(buildOnePager(v, demo, k).whatHappensJa[0]).toContain("経理担当がだまされる");
  });
  it("持ち出し：「業務サーバ区画から情報が持ち出される」", () => {
    const ransom: Case = {
      title: "t",
      damageType: "ransomware",
      clarity: "partial",
      suspiciousInstructions: [],
      steps: [
        { tactic: "TA0001", techniques: ["T1190"], source: "stated", entryKind: "vpn" },
        { tactic: "TA0010", techniques: ["T1041"], source: "stated" },
        { tactic: "TA0040", techniques: ["T1486"], source: "stated" },
      ],
    };
    const text =
      buildOnePager(evaluate(ransom, demo, { knowledge: k }), demo, k).whatHappensJa[0] ?? "";
    expect(text).toMatch(/から情報が持ち出される/);
    expect(text).not.toContain("業務サーバ区画が持ち出される");
  });
});
