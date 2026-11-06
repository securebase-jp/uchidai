/**
 * 被害の種類は knowledge/damage-types.yaml が決める。新しい攻撃を足すと、読解の分類の選択肢・基準と、
 * 出力の検証がそのまま増えること。定義にない種類は検証が拒否すること
 */
import { DamageTypeDef, loadAttack, loadDamageTypes } from "@uchidai/engine";
import { describe, expect, it } from "vitest";
import { buildNoKnowledgeSystem, buildReadSystem, buildRulesJa, RULES_JA } from "./prompts.ts";
import { buildRawCaseJsonSchema, rawCaseJsonSchema } from "./schema.ts";
import { verifyCase } from "./verify.ts";

const added = DamageTypeDef.parse({
  id: "accounting_takeover",
  labelJa: "会計クラウドの乗っ取り",
  shortJa: "会計クラウドの乗っ取り・不正送金",
  readingHintJa: "会計クラウドに不正ログインされ、振込データを書き換えられて送金されたもの",
  day0: { kind: "money", labelJa: "会計クラウドから不正に送金される" },
});
const types = [...loadDamageTypes(), added];
const enumOf = (schema: Record<string, unknown>): string[] =>
  (
    (schema.properties as Record<string, { enum: string[] }>).damageType as {
      enum: string[];
    }
  ).enum;

describe("被害の種類（damage-types.yaml）", () => {
  it("既定の読解スキーマと指示文は、damage-types.yaml のすべての種類と out_of_scope を持つ", () => {
    const ids = loadDamageTypes().map((d) => d.id);
    expect(enumOf(rawCaseJsonSchema)).toEqual([...ids, "out_of_scope"]);
    for (const d of loadDamageTypes()) {
      expect(RULES_JA).toContain(`  - ${d.id}：${d.readingHintJa}`);
    }
    expect(RULES_JA).toContain("  - out_of_scope：上記以外");
  });

  it("種類を足すと、スキーマの選択肢と分類の基準が増える（知見あり・なしの両方）", () => {
    expect(enumOf(buildRawCaseJsonSchema(types))).toContain("accounting_takeover");
    expect(buildRulesJa(types)).toContain(`  - accounting_takeover：${added.readingHintJa}`);
    const text = (b: { type: string; text?: string }[]) => b.map((x) => x.text ?? "").join("\n");
    expect(text(buildNoKnowledgeSystem(types))).toContain("accounting_takeover");
    expect(text(buildReadSystem(loadAttack(), undefined, types))).toContain("accounting_takeover");
    // 足していない既定の指示文には出ない
    expect(RULES_JA).not.toContain("accounting_takeover");
  });

  it("検証は、定義にある種類を通し、定義にない種類は拒否する", () => {
    const base = { title: "x", clarity: "unknown", steps: [], suspiciousInstructions: [] };
    const attack = loadAttack();
    expect(() => verifyCase({ ...base, damageType: "bec" }, "", attack)).not.toThrow();
    expect(() => verifyCase({ ...base, damageType: "out_of_scope" }, "", attack)).not.toThrow();
    expect(() => verifyCase({ ...base, damageType: "accounting_takeover" }, "", attack)).toThrow(
      /未定義の被害の種類/,
    );
    expect(() =>
      verifyCase({ ...base, damageType: "accounting_takeover" }, "", attack, {
        damageTypes: types.map((d) => d.id),
      }),
    ).not.toThrow();
  });
});

describe("読解の指示：委託先のランサム（TRIAL-F-002）", () => {
  it("委託先の事故でも暗号化・身代金要求があれば ransomware、と指示文にある", () => {
    const rules = buildRulesJa();
    expect(rules).toMatch(/委託先.*暗号化・身代金要求・業務停止なら ransomware/);
    expect(rules).toMatch(/漏えいが記事の主題でも.*ransomware/);
  });
});
