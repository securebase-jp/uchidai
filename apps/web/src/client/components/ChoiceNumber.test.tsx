import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EMPLOYEE_PRESETS, REVENUE_PRESETS } from "../lib/choices.ts";
import { ChoiceNumber } from "./ChoiceNumber.tsx";
import { ChoiceSet } from "./ChoiceSet.tsx";

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const pressed = (markup: string) =>
  [...markup.matchAll(/<button[^>]*aria-pressed="true"[^>]*>(.*?)<\/button>/g)].map((m) =>
    (m[1] ?? "").replace(/<[^>]+>/g, ""),
  );

describe("ChoiceNumber", () => {
  it("今の値に当たるボタンだけ aria-pressed、欄には数値、単位が出る", () => {
    const m = html(
      createElement(ChoiceNumber, {
        value: 50,
        presets: EMPLOYEE_PRESETS,
        onCommit: () => {},
        unit: "人",
        ariaLabel: "従業員数",
      }),
    );
    expect(pressed(m)).toEqual(["50"]);
    expect((m.match(/aria-pressed="false"/g) ?? []).length).toBe(5);
    expect(m).toContain('value="50"');
    expect(m).toContain("人");
  });
  it("ボタンに当たらない値（直接入力）はどのボタンも押されない", () => {
    const m = html(
      createElement(ChoiceNumber, {
        value: 45,
        presets: EMPLOYEE_PRESETS,
        onCommit: () => {},
        ariaLabel: "従業員数",
      }),
    );
    expect(pressed(m)).toEqual([]);
    expect(m).toContain('value="45"');
  });
  it("年商のボタン：1 日 1,000 万円のとき 25億 が押された状態、読みやすい表記が添う", () => {
    const m = html(
      createElement(ChoiceNumber, {
        value: 10_000_000,
        presets: REVENUE_PRESETS,
        onCommit: () => {},
        unit: "円",
        ariaLabel: "1 日あたりの売上",
        readout: (n: number) => `${n / 10_000}万円`,
      }),
    );
    expect(pressed(m)).toEqual(["25億"]);
    expect(m).toContain("1000万円");
  });
  it("値が無いときは欄が空で、何も押されない", () => {
    const m = html(
      createElement(ChoiceNumber, {
        value: undefined,
        presets: EMPLOYEE_PRESETS,
        onCommit: () => {},
        ariaLabel: "従業員数",
      }),
    );
    expect(pressed(m)).toEqual([]);
    expect(m).toContain('value=""');
  });
});

describe("ChoiceSet", () => {
  const options = [
    { value: "yes", labelJa: "加入している" },
    { value: "no", labelJa: "していない" },
    { value: "unknown", labelJa: "分からない" },
  ];
  it("今の選択だけ aria-pressed", () => {
    const m = html(
      createElement(ChoiceSet<string>, {
        options,
        value: "no",
        onChange: () => {},
        ariaLabel: "サイバー保険",
      }),
    );
    expect(pressed(m)).toEqual(["していない"]);
  });
  it("押すと onChange（押されているボタンは何もしない）", () => {
    const got: string[] = [];
    const tree = ChoiceSet<string>({
      options,
      value: "no",
      onChange: (v) => got.push(v),
      ariaLabel: "サイバー保険",
    });
    const children = (tree.props as { children: unknown[] }).children.flat() as {
      type: unknown;
      props: { onClick?(): void };
    }[];
    for (const b of children) if (b.type === "button") b.props.onClick?.();
    expect(got).toEqual(["yes", "unknown"]);
  });
});
