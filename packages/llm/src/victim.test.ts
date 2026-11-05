/** 被害を受けた側（victim。victims.yaml）：読解のスキーマ・指示文・検証、一枚の言い換えの規則 */
import { loadAttack, loadVictims, VictimDef } from "@uchidai/engine";
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
