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
      for (const v of Object.values(q.byRole ?? {})) {
        expect(v.textJa).not.toMatch(/\b(M\d{4}|T\d{4})\b/);
        if (v.choices) expect(v.choices.some((c) => c.status === "unknown")).toBe(true);
      }
    }
  });
  it("役割で意味が変わる緩和策は役割ごとの文言を返し、無い役割は共通の文言のまま", () => {
    const k = loadKnowledge();
    // 判定ルールが同じ緩和策を別の意味で見る役割の組み合わせ：byRole に文言があること
    for (const [m, role] of [
      ["M1047", "entry.web"],
      ["M1047", "admin"],
      ["M1047", "server"],
      ["M1047", "file_server"],
      ["M1022", "server"],
      ["M1022", "file_server"],
      ["M1051", "entry.web"],
      ["M1032", "entry.web"],
    ] as const) {
      expect(questionFor(m)?.byRole?.[role], `${m} × ${role}`).toBeDefined();
      expect(k.rules.some((r) => r.role === role && r.mitigations.includes(m))).toBe(true);
    }
    const web = questionFor("M1047", "entry.web");
    expect(web?.textJa).toContain("改ざん");
    expect(web?.byRole).toBeUndefined();
    expect(questionFor("M1047", "cloud.storage")?.textJa).toContain("共有設定");
    expect(questionFor("M1047")?.textJa).toContain("共有設定");
    const vpn = questionFor("M1032", "entry.vpn");
    expect(vpn?.textJa).toContain("VPN");
    expect(vpn?.choices.map((c) => c.id)).toEqual(["all", "partial", "absent", "unknown"]);
    // byRole の役割は roles.yaml にある
    for (const q of allQuestions())
      for (const role of Object.keys(q.byRole ?? {}))
        expect(
          k.roles.some((r) => r.id === role),
          role,
        ).toBe(true);
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
