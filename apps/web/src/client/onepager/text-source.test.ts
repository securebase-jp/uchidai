import { describe, expect, it } from "vitest";
import { withRewrite } from "./params.ts";
import { textSourceView } from "./text-source.ts";

const claude = { source: "claude" as const, model: "claude-sonnet-5-5" };

describe("textSourceView", () => {
  it("Claude の文：モデル名を出す", () => {
    const v = textSourceView({ rewrite: true, available: true, busy: false, text: claude });
    expect(v.statusJa).toBe("文章：Claude が言い換え（claude-sonnet-5-5）");
    expect(v.effectiveRewrite).toBe(true);
  });
  it("テンプレート文：理由を出す（検証で落ちた、キーが無い、切り替えで選んだ）", () => {
    const base = { available: true, busy: false } as const;
    expect(
      textSourceView({
        ...base,
        rewrite: true,
        text: { source: "template", noteJa: "Claude の文を検証で捨てました：数値が違います" },
      }).statusJa,
    ).toBe("文章：テンプレート（Claude の文を検証で捨てました：数値が違います）");
    expect(textSourceView({ ...base, rewrite: false, text: { source: "template" } }).statusJa).toBe(
      "文章：テンプレート（切り替えで選択）",
    );
  });
  it("キーが無いときは Claude を選べず、設定が Claude でもテンプレート側が押された状態になる", () => {
    const v = textSourceView({
      rewrite: true,
      available: false,
      busy: false,
      text: { source: "template", noteJa: "API キーが無いためテンプレート文です" },
    });
    expect(v.canChooseClaude).toBe(false);
    expect(v.effectiveRewrite).toBe(false);
    expect(v.statusJa).toBe("文章：テンプレート（API キーが無いためテンプレート文です）");
  });
  it("キーの有無が不明のうちは、Claude を選べる扱い", () => {
    expect(
      textSourceView({ rewrite: true, available: undefined, busy: true, text: undefined })
        .canChooseClaude,
    ).toBe(true);
  });
  it("Claude に頼んでいる最中は「文を書いています…」。テンプレートなら出さない", () => {
    expect(
      textSourceView({ rewrite: true, available: true, busy: true, text: claude }).statusJa,
    ).toBe("文を書いています…");
    expect(
      textSourceView({ rewrite: false, available: true, busy: true, text: claude }).statusJa,
    ).toBe("");
    expect(
      textSourceView({ rewrite: true, available: false, busy: true, text: undefined }).writing,
    ).toBe(false);
  });
});

describe("withRewrite", () => {
  it("テンプレートは rewrite=0、Claude は rewrite を消す。ほかの指定は残す", () => {
    expect(withRewrite("#/onepager", false)).toBe("#/onepager?rewrite=0");
    expect(withRewrite("#/onepager?profile=demo-seiko&case=ipa-case-1", false)).toBe(
      "#/onepager?profile=demo-seiko&case=ipa-case-1&rewrite=0",
    );
    expect(withRewrite("#/onepager?profile=demo-seiko&rewrite=0", true)).toBe(
      "#/onepager?profile=demo-seiko",
    );
    expect(withRewrite("#/onepager?rewrite=0", true)).toBe("#/onepager");
  });
});
