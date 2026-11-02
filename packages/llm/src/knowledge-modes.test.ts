/**
 * 仕様とのずれ：知見あり／知見なしの 2 モードで Claude に渡すものの違いを固定する。
 * 知見なしでは知見ファイル（日本語ラベル・型紙・判定ルール・役割）も手法一覧も一切渡さない
 */
import type Anthropic from "@anthropic-ai/sdk";
import { loadKnowledge } from "@uchidai/engine";
import { describe, expect, it } from "vitest";
import { readCase, readCaseWithoutKnowledge } from "./reader.ts";

const k = loadKnowledge();
const article = "攻撃者にVPN装置の脆弱性を悪用され、業務データが暗号化された。";

type Captured = {
  system: { text: string; cache_control?: unknown }[];
  messages: { content: string }[];
  tools?: unknown;
  output_config?: unknown;
};

function capturingClient(): { client: Anthropic; get: () => Captured } {
  let captured: Captured | undefined;
  const client = {
    messages: {
      create: async (req: Captured) => {
        captured = req;
        return {
          model: "fake-model",
          stop_reason: "end_turn",
          content: [
            {
              type: "text",
              text: JSON.stringify({
                title: "t",
                damageType: "ransomware",
                clarity: "partial",
                steps: [],
                suspiciousInstructions: [],
              }),
            },
          ],
          usage: { input_tokens: 1, output_tokens: 1 },
        };
      },
    },
  } as unknown as Anthropic;
  return {
    client,
    get: () => {
      if (!captured) throw new Error("リクエストが記録されていない");
      return captured;
    },
  };
}

describe("知見あり（readCase）", () => {
  it("指示文・型紙・手法一覧（日本語ラベルつき）を system に、記事は user に分けて渡す。ツールは渡さない", async () => {
    const { client, get } = capturingClient();
    const r = await readCase(article, {
      client,
      attack: k.attack,
      knowledge: { labels: k.labels, templates: k.templates },
      title: "題",
      url: "https://example.com/a",
    });
    expect(r.model).toBe("fake-model");
    const req = get();
    const system = req.system.map((b) => b.text).join("\n");
    expect(system).toContain("絶対に守ること");
    expect(system).toContain("## 型紙");
    expect(system).toContain("業務停止（ランサムウェア）");
    expect(system).toContain("## 使える手法の一覧");
    expect(system).toContain("T1190");
    expect(system).toContain("｜"); // 日本語ラベル
    expect(req.system.some((b) => b.cache_control)).toBe(true);
    expect(system).not.toContain(article);
    expect(req.messages[0]?.content).toContain(
      `<article source="https://example.com/a" title="題">`,
    );
    expect(req.messages[0]?.content).toContain(article);
    expect(req.tools).toBeUndefined();
    expect(req.output_config).toBeDefined();
  });
});

describe("知見なし（readCaseWithoutKnowledge）", () => {
  it("指示文と出力の形だけで、手法一覧・ラベル・型紙・判定ルール・役割を一切渡さない", async () => {
    const { client, get } = capturingClient();
    await readCaseWithoutKnowledge(article, { client });
    const req = get();
    const system = req.system.map((b) => b.text).join("\n");
    expect(system).toContain("絶対に守ること");
    expect(system).not.toContain("型紙");
    expect(system).not.toContain("## 使える手法の一覧");
    expect(system).not.toMatch(/\bT\d{4}\b/); // 手法 ID の一覧なし
    expect(system).not.toContain("｜"); // 「ID｜日本語ラベル」の形が一つもない
    for (const role of k.roles) expect(system).not.toContain(`${role.id}`);
    for (const t of k.templates) expect(system).not.toContain(t.labelJa);
    for (const r of k.rules) expect(system).not.toContain(r.id);
    expect(req.messages[0]?.content).toContain(article);
    expect(req.tools).toBeUndefined();
  });
});
