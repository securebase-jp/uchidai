import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import {
  fillNames,
  type MeasureRequestInput,
  numberedChoices,
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
};

/** 契約を満たす本文（選択肢は番号つき、返信の案内あり） */
const goodBody = [
  "{{vendor}} 様",
  "{{company}} の{{staff}}です。{{asset}}について教えてください。",
  input.question,
  "このメールに返信し、当てはまる番号と、ご回答者のお名前をお書きください（例：『2　山田』）。",
  "1. 全 PC で共通",
  "2. PC ごとに個別",
  "3. 分からない",
  "背景：T1003 に対する M1026 の判定材料です。期限：2026年11月9日",
].join("\n");

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
  it("キーが無くても動き、質問・番号つきの選択肢・返信の案内・ID・期限・実名を含み、リンクは含まない", async () => {
    const m = await writeVendorRequest(input, { writer: "template" });
    expect(m.writer).toBe("template");
    expect(m.subject).toContain("デモ精工株式会社");
    expect(m.subject).toContain("管理者アカウント（社内 PC 共通）");
    expect(m.text).toContain(input.question);
    expect(m.text).toContain("1. 全 PC で共通\n2. PC ごとに個別\n3. 分からない");
    expect(m.text).toContain(
      "このメールに返信し、当てはまる番号と、ご回答者のお名前をお書きください",
    );
    expect(m.text).toContain("例：「2　山田」");
    expect(m.text).not.toMatch(/https?:\/\/|answer/i);
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
    const m = await writeVendorRequest(input, {
      client: fakeClient({
        subject: "【ご確認】{{asset}}について（{{company}}）",
        body: goodBody,
      }),
    });
    expect(m.writer).toBe("claude");
    expect(m.model).toBe("fake-model");
    expect(m.subject).toBe(
      "【ご確認】管理者アカウント（社内 PC 共通）について（デモ精工株式会社）",
    );
    expect(m.text).toContain("地域の保守ベンダー（架空） 様");
    expect(m.text).toContain("2. PC ごとに個別");
    expect(m.text).not.toContain("{{");
  });
  it("質問文を言い換えた下書きは捨ててテンプレートにする", async () => {
    const m = await writeVendorRequest(input, {
      client: fakeClient({
        subject: "{{asset}}（{{company}}）",
        body: "{{vendor}} 様\n管理者パスワードは共通でしょうか。\n返信でお名前と番号を。\n1. 全 PC で共通\n2. PC ごとに個別\n3. 分からない",
      }),
    });
    expect(m.writer).toBe("template");
    expect(m.fallbackReasonJa).toContain("質問文");
    expect(m.text).toContain(input.question);
  });
  it("URL を作り出した下書きは捨てる", () => {
    expect(
      validateVendorDraft(
        { subject: "{{asset}} {{company}}", body: `${goodBody}\nhttps://example.com/x` },
        input,
      ),
    ).toContain("URL");
  });
  it("メールアドレスを作り出した下書きは捨てる", () => {
    expect(
      validateVendorDraft(
        { subject: "{{asset}} {{company}}", body: `${goodBody}\nご連絡先：a@example.com` },
        input,
      ),
    ).toContain("メールアドレス");
  });
  it("契約を満たす本文は通る（全角の番号つきの書き方も許す）", () => {
    const subject = "{{asset}} {{company}}";
    expect(validateVendorDraft({ subject, body: goodBody }, input)).toBeUndefined();
    const paren = goodBody.replace("1. 全 PC", "（1）全 PC").replace("2. PC", "2　PC");
    expect(validateVendorDraft({ subject, body: paren }, input)).toBeUndefined();
  });
  it("選択肢に番号が無い、番号が違う、選択肢が欠けた下書きは捨てる", () => {
    const subject = "{{asset}} {{company}}";
    const noNumber = goodBody.replace("1. 全 PC で共通", "全 PC で共通");
    expect(validateVendorDraft({ subject, body: noNumber }, input)).toContain("番号つき");
    const swapped = goodBody.replace("2. PC ごとに個別", "3. PC ごとに個別");
    expect(validateVendorDraft({ subject, body: swapped }, input)).toContain("番号つき");
    const missing = goodBody.replace("3. 分からない", "");
    expect(validateVendorDraft({ subject, body: missing }, input)).toContain("分からない");
  });
  it("返信の案内やお名前の依頼が無い下書きは捨てる", () => {
    const subject = "{{asset}} {{company}}";
    const noReply = goodBody.replace("このメールに返信し、", "").replace("返信", "");
    expect(validateVendorDraft({ subject, body: noReply }, input)).toContain("返信");
    const noName = goodBody.replace("ご回答者のお名前", "ご回答者");
    expect(validateVendorDraft({ subject, body: noName }, input)).toContain("お名前");
  });
  it("回答リンクのプレースホルダなど、知らない {{…}} が残った下書きは捨てる", () => {
    expect(
      validateVendorDraft(
        { subject: "{{asset}} {{company}}", body: `${goodBody}\n{{answer_url}}` },
        input,
      ),
    ).toContain("{{answer_url}}");
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

describe("numberedChoices", () => {
  it("質問表の並び順に 1 から振る", () => {
    expect(numberedChoices(["あ", "い", "う"])).toEqual([
      { number: 1, label: "あ" },
      { number: 2, label: "い" },
      { number: 3, label: "う" },
    ]);
  });
});

describe("fillNames", () => {
  it("未指定の宛先と差出人は既定の語になる", () => {
    expect(
      fillNames("{{vendor}}/{{staff}}/{{asset}}", { companyLabel: "A", assetLabel: "B" }),
    ).toBe("保守ご担当者/情報システム担当/B");
  });
});
