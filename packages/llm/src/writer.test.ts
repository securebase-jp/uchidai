import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import {
  fillNames,
  type MeasureRequestInput,
  type VendorRequestInput,
  validateVendorDraft,
  writeMeasureRequest,
  writeVendorRequest,
} from "./writer.ts";

const input: VendorRequestInput = {
  companyLabel: "デモ精工株式会社",
  vendorLabel: "地域の保守ベンダー（架空）",
  assetLabel: "管理者アカウント（社内 PC 共通）",
  assetRoleLabel: "管理者アカウント",
  question: "管理者のパスワードは、全 PC で共通ですか",
  choices: ["全 PC で共通", "PC ごとに個別", "分からない"],
  mitigationId: "M1026",
  mitigationLabel: "特権アカウント管理",
  techniqueId: "T1003",
  techniqueLabel: "OS 認証情報のダンプ",
  materialsJa: "カルテ：EDR の有無と監視体制、管理者アカウントの分離",
  deadline: "2026年11月9日",
  answerUrl: "http://localhost:5173/#/answer/abc",
};

/** Claude の応答を偽装する最小のクライアント */
function fakeClient(payload: unknown, stopReason = "end_turn"): Anthropic {
  return {
    messages: {
      create: async () => ({
        stop_reason: stopReason,
        content: [{ type: "text", text: JSON.stringify(payload) }],
        model: "fake-model",
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    },
  } as unknown as Anthropic;
}

describe("writeVendorRequest（テンプレート）", () => {
  it("キーが無くても動き、質問・選択肢・回答 URL・ID・期限・実名を含む", async () => {
    const m = await writeVendorRequest(input, { writer: "template" });
    expect(m.writer).toBe("template");
    expect(m.subject).toContain("デモ精工株式会社");
    expect(m.subject).toContain("管理者アカウント（社内 PC 共通）");
    expect(m.text).toContain(input.question);
    expect(m.text).toContain("全 PC で共通／PC ごとに個別／分からない");
    expect(m.text).toContain(input.answerUrl);
    expect(m.text).toContain("T1003");
    expect(m.text).toContain("M1026");
    expect(m.text).toContain("2026年11月9日");
    expect(m.text).toContain("地域の保守ベンダー（架空） 様");
    expect(m.text).not.toContain("{{");
  });
  it("writer を指定しなければ、キーも client も無いときはテンプレート", async () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const m = await writeVendorRequest(input);
      expect(m.writer).toBe("template");
    } finally {
      if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
    }
  });
});

describe("writeVendorRequest（Claude の出力の検証）", () => {
  it("契約を満たす下書きは実名を差し込んで使う", async () => {
    const body = [
      "{{vendor}} 様",
      "{{company}} の{{staff}}です。{{asset}}について教えてください。",
      input.question,
      "選択肢：全 PC で共通／PC ごとに個別／分からない",
      "回答はこちら：{{answer_url}}",
      "背景：T1003 に対する M1026 の判定材料です。期限：2026年11月9日",
    ].join("\n");
    const m = await writeVendorRequest(input, {
      client: fakeClient({ subject: "【ご確認】{{asset}}について（{{company}}）", body }),
    });
    expect(m.writer).toBe("claude");
    expect(m.model).toBe("fake-model");
    expect(m.subject).toBe(
      "【ご確認】管理者アカウント（社内 PC 共通）について（デモ精工株式会社）",
    );
    expect(m.text).toContain("地域の保守ベンダー（架空） 様");
    expect(m.text).toContain(input.answerUrl);
    expect(m.text).not.toContain("{{");
  });
  it("質問文を言い換えた下書きは捨ててテンプレートにする", async () => {
    const m = await writeVendorRequest(input, {
      client: fakeClient({
        subject: "{{asset}}（{{company}}）",
        body: "{{vendor}} 様\n管理者パスワードは共通でしょうか。\n{{answer_url}}\n全 PC で共通／PC ごとに個別／分からない",
      }),
    });
    expect(m.writer).toBe("template");
    expect(m.fallbackReasonJa).toContain("質問文");
    expect(m.text).toContain(input.question);
  });
  it("URL を作り出した下書きは捨てる", () => {
    expect(
      validateVendorDraft(
        {
          subject: "{{asset}} {{company}}",
          body: `${input.question}\n全 PC で共通 PC ごとに個別 分からない {{answer_url}} https://example.com/x`,
        },
        input,
      ),
    ).toContain("URL");
  });
  it("Claude が拒否・失敗してもテンプレートで返す", async () => {
    const m = await writeVendorRequest(input, { client: fakeClient({}, "refusal") });
    expect(m.writer).toBe("template");
    expect(m.fallbackReasonJa).toBeDefined();
    expect(m.text).toContain(input.question);
  });
});

describe("writeMeasureRequest", () => {
  const mi: MeasureRequestInput = {
    companyLabel: "デモ精工株式会社",
    assetLabel: "VPN装置",
    assetRoleLabel: "VPN装置",
    measureLabel: "VPN装置の更新",
    mitigationId: "M1051",
    mitigationLabel: "ソフトウェアの更新",
    techniqueId: "T1190",
    techniqueLabel: "公開アプリケーションの悪用",
    costJa: "ベンダーの見積もり待ち",
    deadline: "2026年11月30日",
  };
  it("テンプレート：対象、依頼内容、手法 ID と緩和策 ID、希望期限を含む", async () => {
    const m = await writeMeasureRequest(mi, { writer: "template" });
    expect(m.writer).toBe("template");
    expect(m.text).toContain("■ 対象\nVPN装置");
    expect(m.text).toContain("VPN装置の更新（M1051：ソフトウェアの更新）");
    expect(m.text).toContain("T1190");
    expect(m.text).toContain("希望期限：2026年11月30日");
    expect(m.text).toContain("保守ご担当者 様");
  });
  it("Claude の下書きに緩和策 ID が無ければテンプレートにする", async () => {
    const m = await writeMeasureRequest(mi, {
      client: fakeClient({
        subject: "{{asset}}（{{company}}）",
        body: "VPN装置の更新をお願いします。".repeat(3),
      }),
    });
    expect(m.writer).toBe("template");
    expect(m.fallbackReasonJa).toContain("緩和策 ID");
  });
});

describe("fillNames", () => {
  it("未指定の宛先と差出人は既定の語になる", () => {
    expect(
      fillNames("{{vendor}}/{{staff}}/{{asset}}", { companyLabel: "A", assetLabel: "B" }),
    ).toBe("保守ご担当者/情報システム担当/B");
  });
});
