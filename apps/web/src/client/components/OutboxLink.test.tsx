import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OutboxLink } from "./OutboxLink.tsx";

describe("OutboxLink（依頼済み・回答待ちの札）", () => {
  it("札の見た目のまま、押せるボタンで、矢印と title/aria-label を持つ", () => {
    const m = renderToStaticMarkup(
      createElement(OutboxLink, { assetId: "admin", mitigation: "M1026" }),
    );
    expect(m).toContain("<button");
    expect(m).toContain('type="button"');
    expect(m).toContain("st amber");
    expect(m).toContain("依頼済み・回答待ち");
    expect(m).toContain("›");
    expect(m).toContain('title="送信箱を開く"');
    expect(m).toContain("aria-label=");
  });
});
