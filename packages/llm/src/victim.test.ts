/** 被害を受けた側（victim。victims.yaml）：読解のスキーマ・指示文・検証、一枚の言い換えの規則 */
import { loadAttack, loadLeakKinds, loadVictims, VictimDef } from "@uchidai/engine";
import { describe, expect, it } from "vitest";
import { checkWriterOutput, type OnePagerWriterInput } from "./onepager-writer.ts";
import { buildRulesJa } from "./prompts.ts";
import { buildRawCaseJsonSchema } from "./schema.ts";
import { verifyCase } from "./verify.ts";

const attack = loadAttack();
const article = "再委託先のVPN機器から侵入され、データが暗号化された。";
const raw = (victim?: string | null) => ({
  title: "t",
  damageType: "ransomware",
  clarity: "partial",
  ...(victim === undefined ? {} : { victim }),
  steps: [
    {
      tactic: "TA0040",
      techniques: ["T1486"],
      source: "stated",
      certainty: "confirmed",
      entryKind: null,
      quote: "データが暗号化された。",
      summaryJa: "データが暗号化された",
    },
  ],
  suspiciousInstructions: [],
});

describe("読解のスキーマと指示文は victims.yaml から組み立てる", () => {
  const victims = loadVictims();
  it("スキーマの victim の選択肢は YAML の id と null。必須の欄", () => {
    const schema = buildRawCaseJsonSchema() as {
      required: string[];
      properties: { victim: { anyOf: { enum?: string[]; type: string }[] } };
    };
    expect(schema.required).toContain("victim");
    expect(schema.properties.victim.anyOf).toEqual([
      { type: "string", enum: victims.map((v) => v.id) },
      { type: "null" },
    ]);
  });
  it("group（グループ会社＝子会社・孫会社）は選択肢にあり、vendor の基準にはグループ会社を含めない", () => {
    expect(victims.map((v) => v.id)).toContain("group");
    const text = buildRulesJa();
    expect(text).toMatch(
      /group：被害を受けたのは、記事を公表した会社（親会社）自身ではなく、その子会社・孫会社/,
    );
    expect(victims.find((v) => v.id === "vendor")?.readingHintJa).not.toMatch(/グループ会社/);
  });
  it("指示文に分類基準が入り、種類を足せば増える", () => {
    const text = buildRulesJa();
    for (const v of victims) expect(text).toContain(`${v.id}：`);
    const extra = VictimDef.parse({
      id: "parent",
      labelJa: "親会社",
      thirdParty: true,
      readingHintJa: "親会社の側で起きた被害",
    });
    expect(buildRulesJa(undefined, undefined, [...victims, extra])).toContain("parent：親会社の側");
    const schema = buildRawCaseJsonSchema(undefined, undefined, [...victims, extra]) as {
      properties: { victim: { anyOf: { enum?: string[] }[] } };
    };
    expect(schema.properties.victim.anyOf[0]?.enum).toContain("parent");
  });
});

describe("verifyCase は定義済みの被害を受けた側だけを残す", () => {
  it("第三者の値は残り、self と省略は持たせない（従来の Case と同じ形）", () => {
    expect(verifyCase(raw("vendor"), article, attack).case.victim).toBe("vendor");
    expect(verifyCase(raw("provider"), article, attack).case.victim).toBe("provider");
    expect(verifyCase(raw("group"), article, attack).case.victim).toBe("group");
    expect(verifyCase(raw("self"), article, attack).case.victim).toBeUndefined();
    expect(verifyCase(raw(null), article, attack).case.victim).toBeUndefined();
    expect(verifyCase(raw(), article, attack).case.victim).toBeUndefined();
  });
  it("定義にない値は捨てて、報告する", () => {
    const r = verifyCase(raw("alien"), article, attack);
    expect(r.case.victim).toBeUndefined();
    expect(r.report.droppedVictim).toBe("alien");
  });
});

describe("一枚の言い換え：第三者の事故", () => {
  const input: OnePagerWriterInput = {
    result: "breached",
    stages: [{ labelJa: "入口から侵入", roleJa: "VPN装置", state: "breached", source: "stated" }],
    stopped: [{ name: "受注", days: 10, manualDays: 2 }],
    downtimeDays: 10,
    reportRequired: false,
    personalDataJa: [],
    thirdPartyJa: "委託先・取引先",
  };
  const ok = [
    "これは委託先・取引先で起きた事故です。",
    "記事の委託先・取引先では、VPN装置から侵入されたことが確認されています。",
    "御社が同じ立場なら、受注が10日止まると見込まれます。",
  ];
  it("「これは〇〇で起きた事故です」が無い文は捨てる", () => {
    expect(checkWriterOutput({ whatHappensJa: ok.slice(1) }, input)).toMatch(/で起きた事故です/);
  });
  it("御社の設備の事実のように「VPN装置から侵入されたことが確認されています」と書くと捨てる", () => {
    expect(
      checkWriterOutput(
        {
          whatHappensJa: [
            ok[0] as string,
            "VPN装置から侵入されたことが確認されています。",
            ok[2] as string,
          ],
        },
        input,
      ),
    ).toMatch(/記事の委託先・取引先では/);
  });
  it("確認の言い方を使う最初の文が「記事の〇〇では」なら、続く文は主語を引き継いでよい", () => {
    expect(
      checkWriterOutput(
        {
          whatHappensJa: [
            ok[0] as string,
            "記事の委託先・取引先では、VPN装置から侵入されたことが確認されています。",
            "続けて、データが暗号化されたことも確認されています。",
            ok[2] as string,
          ],
        },
        input,
      ),
    ).toBeUndefined();
  });
  it("「記事の〇〇では〜」と書き、試算を「御社が同じ立場なら〜と見込まれます」と書けば通る", () => {
    expect(checkWriterOutput({ whatHappensJa: ok }, input)).toBeUndefined();
  });
  it("グループ会社など、固定の注意の文（thirdPartyNoteJa）があるときは、その文を書かないと捨てる", () => {
    const g: OnePagerWriterInput = {
      ...input,
      thirdPartyJa: "グループ会社（子会社・孫会社）",
      thirdPartyNoteJa: "子会社と御社の接続の有無は、この公表からは分かりません。",
    };
    const lines = [
      "これはグループ会社（子会社・孫会社）で起きた事故です。",
      "記事のグループ会社（子会社・孫会社）では、VPN装置から侵入されたことが確認されています。",
      "御社が同じ立場なら、受注が10日止まると見込まれます。",
    ];
    expect(checkWriterOutput({ whatHappensJa: lines }, g)).toMatch(/注意の文/);
    expect(
      checkWriterOutput(
        {
          whatHappensJa: [
            lines[0] as string,
            "子会社と御社の接続の有無は、この公表からは分かりません。",
            ...lines.slice(1),
          ],
        },
        g,
      ),
    ).toBeUndefined();
  });
  it("第三者の事故でなければ、これまでどおり（「御社の場合は」で足りる）", () => {
    const { thirdPartyJa: _t, ...own } = input;
    expect(
      checkWriterOutput(
        {
          whatHappensJa: [
            "VPN装置から侵入されたことが確認されています。",
            "御社の場合は、受注が10日止まると見込まれます。",
          ],
        },
        own,
      ),
    ).toBeUndefined();
  });
});

describe("D-007：報告は「必要ない」と書かない。止まる結論は「この経路では」と限る", () => {
  const base: OnePagerWriterInput = {
    result: "blocked",
    stages: [{ labelJa: "入口から侵入", roleJa: "VPN装置", state: "blocked", source: "stated" }],
    stopped: [],
    downtimeDays: 0,
    reportRequired: false,
    personalDataJa: [],
  };
  it("「個人情報の報告も必要ありません」「不要」を含む文は捨てる", () => {
    for (const line of [
      "個人情報の報告も必要ありません。",
      "報告は不要です。",
      "個人情報の報告が必要ない見込みです。",
    ]) {
      expect(
        checkWriterOutput({ whatHappensJa: ["この経路では入口で止まります。", line] }, base),
      ).toMatch(/報告/);
    }
  });
  it("blocked の結論に「この経路では」が無ければ捨てる", () => {
    expect(checkWriterOutput({ whatHappensJa: ["入口で止まります。"] }, base)).toMatch(
      /この経路では/,
    );
    expect(
      checkWriterOutput({ whatHappensJa: ["この経路では、VPN装置の入口で止まります。"] }, base),
    ).toBeUndefined();
  });
});

describe("D-011：読解の leakedData は leak-kinds.yaml から組み立て、定義済みの値だけ残す", () => {
  it("スキーマの選択肢と指示文は YAML から。必須の欄", () => {
    const kinds = loadLeakKinds();
    const schema = buildRawCaseJsonSchema() as {
      required: string[];
      properties: { leakedData: { items: { enum: string[] } } };
    };
    expect(schema.required).toContain("leakedData");
    expect(schema.properties.leakedData.items.enum).toEqual(kinds.map((l) => l.id));
    const text = buildRulesJa();
    for (const l of kinds) expect(text).toContain(`${l.id}：`);
  });
  it("定義済みの値は残り（重複は 1 つ）、定義にない値は捨てて報告する。無ければ持たせない", () => {
    const withData = (leakedData?: string[]) => ({
      ...raw(null),
      ...(leakedData ? { leakedData } : {}),
    });
    const r = verifyCase(withData(["payment", "payment", "sensitive", "alien"]), article, attack);
    expect(r.case.leakedData).toEqual(["payment", "sensitive"]);
    expect(r.report.droppedLeakedData).toEqual(["alien"]);
    expect(verifyCase(withData([]), article, attack).case.leakedData).toBeUndefined();
    expect(verifyCase(withData(), article, attack).case.leakedData).toBeUndefined();
  });
});

describe("B-003・B-013：読解の被害額と未遂", () => {
  const body = "取引先を装った詐欺で、約2.56億円が送金された。被害額は他に300円。";
  const withFacts = (reportedLossJpy: number | null, averted?: boolean) => ({
    ...raw(null),
    reportedLossJpy,
    ...(averted === undefined ? {} : { averted }),
  });
  it("記事の円の金額に一致する被害額は残す。作った値・外貨は捨てて報告する", () => {
    expect(verifyCase(withFacts(256_000_000), body, attack).case.reportedLossJpy).toBe(256_000_000);
    const bad = verifyCase(withFacts(300_000_000), body, attack);
    expect(bad.case.reportedLossJpy).toBeUndefined();
    expect(bad.report.droppedReportedLoss).toBe(300_000_000);
    expect(verifyCase(withFacts(null), body, attack).case.reportedLossJpy).toBeUndefined();
    expect(verifyCase(withFacts(-5), body, attack).case.reportedLossJpy).toBeUndefined();
  });
  it("averted は true のときだけ持たせる（本文に未遂・阻止などの語があるとき）", () => {
    const foiled = `${body}ただし、別の送金は銀行が阻止した。`;
    expect(verifyCase(withFacts(null, true), foiled, attack).case.averted).toBe(true);
    expect(verifyCase(withFacts(null, false), foiled, attack).case.averted).toBeUndefined();
  });
  it("TRIAL-I-003：「漏えいの事実は確認されていない」だけの本文なら、averted: true を false にして report に残す", () => {
    const text =
      "提供元で不正アクセスがあり、メールアドレスが漏えいした可能性がある。実際に漏えいしたことを示す事実は確認されていない。";
    const r = verifyCase(withFacts(null, true), text, attack);
    expect(r.case.averted).toBeUndefined();
    expect(r.report.droppedAverted).toBe(true);
    // 語がある本文は残す
    for (const w of [
      "未遂に終わった",
      "被害を防いだ",
      "被害は発生していない",
      "送金前に気づいた",
      "被害には至らなかった",
    ])
      expect(
        verifyCase(withFacts(null, true), `不正な送金の依頼があったが、${w}。`, attack).case
          .averted,
      ).toBe(true);
    // 「防げなかった」は未遂ではない
    expect(
      verifyCase(withFacts(null, true), "被害を防げなかった。", attack).case.averted,
    ).toBeUndefined();
  });
  it("スキーマと指示文に入る", () => {
    const schema = buildRawCaseJsonSchema() as { required: string[] };
    expect(schema.required).toEqual(expect.arrayContaining(["reportedLossJpy", "averted"]));
    expect(buildRulesJa()).toMatch(/reportedLossJpy：記事が書く被害額/);
  });
});

describe("B-003・TRIAL-016・B-013：言い換えの金額と未遂の規則", () => {
  const input: OnePagerWriterInput = {
    result: "breached",
    stages: [{ labelJa: "段階", roleJa: "役割", state: "breached", source: "stated" }],
    stopped: [],
    downtimeDays: 0,
    reportRequired: false,
    personalDataJa: [],
    moneyLossJpy: 5_000_000,
    reportedLossJpy: 256_000_000,
  };
  const lines = (...l: string[]) => ({ whatHappensJa: l });
  const ok = [
    "社長を装った送金指示が確認されています。",
    "記事の事例では、被害額は約2.56億円です。",
    "御社の想定では、約500万円の資金が流出すると見込まれます。",
  ];
  it("御社の金額に「想定」が無い文、売上と並べた文は捨てる（TRIAL-016）", () => {
    expect(
      checkWriterOutput(
        lines(ok[0] as string, ok[1] as string, "資金が約500万円流出します。"),
        input,
      ),
    ).toMatch(/想定/);
    expect(
      checkWriterOutput(
        lines(
          ok[0] as string,
          ok[1] as string,
          "御社の想定では、売上への影響として約500万円が見込まれます。",
        ),
        input,
      ),
    ).toMatch(/直接の損失/);
  });
  it("記事の被害額は「記事の事例では」と書かないと捨てる。並べて書けば通る", () => {
    expect(checkWriterOutput(lines(ok[0] as string, ok[2] as string), input)).toMatch(
      /記事の事例では/,
    );
    expect(checkWriterOutput({ whatHappensJa: ok }, input)).toBeUndefined();
  });
  it("未遂の記事は「防げ」と書く", () => {
    const averted = { ...input, avertedInArticle: true };
    expect(checkWriterOutput({ whatHappensJa: ok }, averted)).toMatch(/防げた事例/);
    expect(
      checkWriterOutput(
        { whatHappensJa: ["記事の会社は被害を防げた事例です。", ...ok.slice(1)] },
        averted,
      ),
    ).toBeUndefined();
  });
});
