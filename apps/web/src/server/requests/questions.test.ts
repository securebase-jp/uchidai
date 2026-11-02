import { loadKnowledge } from "@uchidai/engine";
import { describe, expect, it } from "vitest";
import { allQuestions, backgroundFor, questionFor } from "./questions.ts";

describe("質問表", () => {
  it("判定ルールが参照する緩和策すべてに質問がある", () => {
    const k = loadKnowledge();
    const referenced = new Set(k.rules.flatMap((r) => r.mitigations));
    const missing = [...referenced].filter((m) => !questionFor(m));
    expect(missing).toEqual([]);
  });
  it("各質問は 1 問で、「分からない」を含む選択式。選択肢の ID は重複しない", () => {
    for (const q of allQuestions()) {
      expect(q.textJa.length).toBeGreaterThan(5);
      expect(q.choices.length).toBeGreaterThanOrEqual(3);
      expect(q.choices.some((c) => c.status === "unknown")).toBe(true);
      expect(new Set(q.choices.map((c) => c.id)).size).toBe(q.choices.length);
    }
  });
  it("質問の文言に ATT&CK の ID を出さない（背景として別に添える）", () => {
    for (const q of allQuestions()) {
      expect(q.textJa).not.toMatch(/\b(M\d{4}|T\d{4})\b/);
    }
  });
  it("背景：役割に当たるルールから手法 ID と判定の材料を取る", () => {
    const k = loadKnowledge();
    const bg = backgroundFor("M1026", "admin", k);
    expect(bg.ruleId).toBe("ransomware.credentials");
    expect(bg.techniqueId).toBe("T1003");
    expect(bg.mitigationLabelJa).toBe("特権アカウント管理");
    expect(bg.materialsJa).toContain("管理者アカウント");
    const ud = backgroundFor("UD-01", "person.accounting", k);
    expect(ud.mitigationLabelJa).toContain("折り返し");
    expect(ud.techniqueId).toBeUndefined();
  });
});
