/** 入口の種類（entry-kinds.yaml）：読解のスキーマと指示文が YAML から組み立てられ、verifyCase が正しく残す／捨てる */
import { EntryKindDef, loadAttack, loadEntryKinds } from "@uchidai/engine";
import { describe, expect, it } from "vitest";
import { buildRulesJa } from "./prompts.ts";
import { buildRawCaseJsonSchema } from "./schema.ts";
import { verifyCase } from "./verify.ts";

const attack = loadAttack();
const article =
  "リモートデスクトップが外部に公開されていた端末から侵入された。データが暗号化された。";
const rawCase = (steps: object[]) => ({
  title: "t",
  damageType: "ransomware",
  clarity: "partial",
  steps,
  suspiciousInstructions: [],
});
const step = (o: Record<string, unknown>) => ({
  tactic: "TA0001",
  techniques: ["T1133"],
  source: "stated",
  certainty: "confirmed",
  entryKind: "rdp",
  quote: "リモートデスクトップが外部に公開されていた端末から侵入された。",
  summaryJa: "リモートデスクトップから侵入された",
  ...o,
});

describe("読解のスキーマと指示文は entry-kinds.yaml から組み立てる", () => {
  const kinds = loadEntryKinds();
  it("スキーマの entryKind の選択肢は YAML の種類と null", () => {
    const schema = buildRawCaseJsonSchema() as {
      properties: {
        steps: {
          items: {
            required: string[];
            properties: Record<string, { anyOf?: { enum?: string[]; type: string }[] }>;
          };
        };
      };
    };
    const items = schema.properties.steps.items;
    expect(items.required).toContain("entryKind");
    expect(items.properties.entryKind?.anyOf).toEqual([
      { type: "string", enum: kinds.map((k) => k.id) },
      { type: "null" },
    ]);
  });
  it("指示文に全種類の分類基準が入り、種類を足せば増える", () => {
    const text = buildRulesJa();
    for (const k of kinds) expect(text).toContain(`${k.id}：`);
    const extra = EntryKindDef.parse({
      id: "wifi",
      labelJa: "無線",
      roles: ["entry.rdp"],
      readingHintJa: "社内の無線 LAN からの侵入",
    });
    const schema = buildRawCaseJsonSchema(undefined, [...kinds, extra]) as {
      properties: {
        steps: {
          items: { properties: Record<string, { anyOf?: { enum?: string[]; type: string }[] }> };
        };
      };
    };
    expect(schema.properties.steps.items.properties.entryKind?.anyOf?.[0]?.enum).toContain("wifi");
    expect(buildRulesJa(undefined, [...kinds, extra])).toContain("wifi：社内の無線 LAN");
  });
});

describe("verifyCase は入口の種類を、入口の段階で入口が分かるときだけ残す", () => {
  it("入口（TA0001）の段階の定義済みの種類は残る", () => {
    const { case: c } = verifyCase(rawCase([step({})]), article, attack);
    expect(c.steps[0]?.entryKind).toBe("rdp");
  });
  it("定義にない種類・入口以外の段階・入口が不明の段階の種類は捨てる", () => {
    const r = verifyCase(
      rawCase([
        step({ entryKind: "teleport" }),
        step({
          tactic: "TA0040",
          techniques: ["T1486"],
          entryKind: "rdp",
          quote: null,
          source: "inferred",
        }),
        step({ source: "unknown", techniques: [], quote: null, summaryJa: "侵入方法は記載なし" }),
      ]),
      article,
      attack,
    );
    expect(r.case.steps.every((s) => s.entryKind === undefined)).toBe(true);
    expect(r.report.droppedEntryKinds.map((d) => d.kind)).toEqual(["teleport", "rdp", "rdp"]);
  });
  it("入口の方法が「記載なし」と書かれた段階は unknown になり、種類も残らない（確度の補正と同じ）", () => {
    const { case: c } = verifyCase(
      rawCase([step({ summaryJa: "侵入方法は記事に記載なし" })]),
      article,
      attack,
    );
    expect(c.steps[0]).toMatchObject({ source: "unknown" });
    expect(c.steps[0]?.entryKind).toBeUndefined();
  });
  it("種類の欄が無い古い記録でも読める（省略は種類が分からない）", () => {
    const { entryKind: _omit, ...old } = step({});
    const { case: c } = verifyCase(rawCase([old]), article, attack);
    expect(c.steps[0]?.entryKind).toBeUndefined();
  });
});
