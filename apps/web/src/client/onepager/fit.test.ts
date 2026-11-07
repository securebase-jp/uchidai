/**
 * 一枚を 2 ページに収める詰め方の段（Issue #12）。
 * - 段の上限（KEEP）と、onepager.css の規則が同じ数であること
 * - 項目を隠すのは印刷・PDF だけで、画面と共有の描画には全部の項目が残り、「ほか N 件」は画面に出ないこと
 * - 段の上げ方（nextFit）
 * 実際の寸法（全カルテ × 全事故で 3 ページ以上が 0 件）はブラウザで測る。ここでは約束が崩れないことを確かめる
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { app } from "../../server/app.ts";
import type { OnePagerResponse } from "../lib/api.ts";
import { cutPoints, FIT_MAX, KEEP, nextFit } from "./fit.ts";
import { OnePagerView, viewDataFromResponse } from "./OnePagerView.tsx";

// 整形（改行・字下げ）に左右されないよう、空白を 1 つにして読む
const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "onepager.css"),
  "utf8",
).replace(/\s+/g, " ");
const PRINT = ":is(:root.printing, :root.print-preview, .op-capture)";

// biome-ignore lint/suspicious/noExplicitAny: テストでは応答の形を緩く読む
type Loose = any;

async function clinicCase1(): Promise<OnePagerResponse> {
  const c: Loose = await (await app.request("/api/case/recorded/ipa-case-1")).json();
  const p: Loose = await (await app.request("/api/examples/demo-clinic")).json();
  const res = await app.request("/api/onepager", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ case: c.case, profile: p.profile, rewrite: false }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as OnePagerResponse;
}

describe("項目の上限と『ほか N 件』の位置", () => {
  it("上限は段が上がるほど小さく（同じか減る）、段 0 は上限なし", () => {
    for (const keeps of Object.values(KEEP)) {
      expect(keeps[0]).toBe(Number.POSITIVE_INFINITY);
      for (let i = 1; i < keeps.length; i++)
        expect(keeps[i] as number).toBeLessThanOrEqual(keeps[i - 1] as number);
    }
  });

  it("切る位置は、項目数より小さい上限だけ（昇順・重複なし）", () => {
    expect(cutPoints("lines", 12)).toEqual([3, 4, 6]);
    expect(cutPoints("lines", 5)).toEqual([3, 4]);
    expect(cutPoints("lines", 3)).toEqual([]);
    expect(cutPoints("stopped", 4)).toEqual([3]);
    expect(cutPoints("measures", 9)).toEqual([4, 6]);
    expect(cutPoints("deadlines", 6)).toEqual([4]);
  });
});

describe("onepager.css の段の規則は KEEP と同じ数で、印刷・PDF だけに効く", () => {
  // 隠す規則の書き方（リストごと）と、段の添字（何が起きる・止まる業務は a、対策・期限は b）
  const HIDE: Record<keyof typeof KEEP, { axis: "a" | "b"; sel: (k: number) => string }> = {
    lines: { axis: "a", sel: (k) => `.op-lines > li:nth-child(n + ${k + 1}):not(.op-more)` },
    stopped: { axis: "a", sel: (k) => `.op-biz > li:nth-child(n + ${k + 1}):not(.op-more)` },
    measures: { axis: "b", sel: (k) => `.op-cards > .op-card:nth-child(n + ${k + 1})` },
    deadlines: { axis: "b", sel: (k) => `.op-spine > li:nth-child(n + ${k + 1}):not(.op-more)` },
  };
  const LIST_CLASS = {
    lines: ".op-lines",
    stopped: ".op-biz",
    measures: ".op-cards",
    deadlines: ".op-spine",
  } as const;

  it("有限の上限ごとに、その段で隠す規則と『ほか N 件』を出す規則がある", () => {
    for (const [list, keeps] of Object.entries(KEEP) as [keyof typeof KEEP, readonly number[]][]) {
      const { axis, sel } = HIDE[list];
      keeps.forEach((k, level) => {
        if (!Number.isFinite(k)) return;
        const hide = `${PRINT} .op-paper[data-fit-${axis}="${level}"] ${sel(k)}`;
        expect(css, `${list} 段 ${level} の隠す規則`).toContain(hide);
        const show = `${PRINT} .op-paper[data-fit-${axis}="${level}"] ${LIST_CLASS[list]} > .op-more[data-keep="${k}"]`;
        expect(css, `${list} 段 ${level} の「ほか N 件」を出す規則`).toContain(show);
      });
    }
  });

  it("段（data-fit-*）の規則は、すべて印刷・PDF の範囲の中にある（画面には効かない）", () => {
    const rules = css
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("}")
      .filter((r) => r.includes("data-fit-"));
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      // :is(...) の中のカンマでは切らない
      const selectors = rule.slice(0, rule.indexOf("{")).split(/,(?![^(]*\))/);
      for (const s of selectors) expect(s.trim().startsWith(PRINT), s).toBe(true);
    }
  });

  it("『ほか N 件』は、印刷の段で選ばれたとき以外は表示しない", () => {
    expect(css).toMatch(/\.op-paper li\.op-more\s*\{\s*display:\s*none;/);
  });

  it("経路図の高さの上限は、段が上がるほど小さい（差分のある一枚は同じ段でも小さいか同じ）", () => {
    const h = (sel: string): number => {
      const i = css.indexOf(sel);
      expect(i, `${sel} が無い`).toBeGreaterThanOrEqual(0);
      const m = /max-height:\s*([0-9.]+)mm/.exec(css.slice(i, css.indexOf("}", i)));
      return Number(m?.[1]);
    };
    const normal = h(`${PRINT} .op-figure svg.diagram {`);
    const a2 = h(`${PRINT} .op-paper[data-fit-a="2"] .op-figure svg.diagram {`);
    const a3 = h(`${PRINT} .op-paper[data-fit-a="3"] .op-figure svg.diagram {`);
    expect(normal).toBeGreaterThan(a2);
    expect(a2).toBeGreaterThan(a3);
    expect(
      h(`${PRINT} .op-paper.op-has-changes[data-fit-a="2"] .op-figure svg.diagram {`),
    ).toBeLessThanOrEqual(a2);
    expect(
      h(`${PRINT} .op-paper.op-has-changes[data-fit-a="3"] .op-figure svg.diagram {`),
    ).toBeLessThanOrEqual(a3);
  });
});

describe("画面の描画は、項目を 1 件も減らさない", () => {
  it("デモクリニック × 事例 1：全部の項目が出て、段は付かず、『ほか N 件』は印刷の切り替えを待つ印だけ", async () => {
    const data = await clinicCase1();
    const op = data.onePager;
    const html = renderToStaticMarkup(
      createElement(OnePagerView, { data: viewDataFromResponse(data) }),
    );
    // 段は測ったあと（ブラウザ）に付く。描画の時点では付いていない
    expect(html).not.toContain("data-fit-");
    // 項目はすべて出ている（上限は CSS の印刷でだけ効く）
    const count = (cls: string, item: string) => {
      const block = new RegExp(`<(?:ol|ul) class="${cls}"[^>]*>([\\s\\S]*?)</(?:ol|ul)>`).exec(
        html,
      );
      return (block?.[1]?.match(new RegExp(item, "g")) ?? []).length;
    };
    expect(count("op-lines", "<li>")).toBe(op.whatHappensJa.length);
    expect(count("op-biz", "<li>")).toBe(op.stopped.length);
    expect(count("op-spine", '<li class="k-')).toBe(op.deadlines.length);
    // 切る位置の印：何が起きる（4 件 → 3 で切る）、止まる業務（4 件 → 3）、期限（6 件 → 4）
    expect(html).toContain('class="op-more" data-keep="3"');
    expect(html).toContain('class="op-more" data-keep="4"');
    expect(html).toMatch(/data-keep="3">ほか (<!-- -->)?1(<!-- -->)? 件/);
  });
});

describe("段の上げ方", () => {
  const m = (over: Partial<Parameters<typeof nextFit>[1]> = {}) => ({
    pages: 3,
    part1Over: false,
    hasBreak: true,
    ...over,
  });

  it("2 ページに収まっていれば上げない", () => {
    expect(nextFit({ a: 0, b: 0 }, m({ pages: 2 }))).toBeUndefined();
    expect(nextFit({ a: 2, b: 1 }, m({ pages: 1 }))).toBeUndefined();
  });

  it("1 枚目が溢れていれば a、そうでなければ b を 1 つ上げる", () => {
    expect(nextFit({ a: 0, b: 0 }, m({ part1Over: true }))).toEqual({ a: 1, b: 0 });
    expect(nextFit({ a: 1, b: 0 }, m())).toEqual({ a: 1, b: 1 });
  });

  it("上げ切った側は上げず、もう一方を上げる。両方上げ切ったら止める", () => {
    expect(nextFit({ a: FIT_MAX.a, b: 0 }, m({ part1Over: true }))).toEqual({ a: FIT_MAX.a, b: 1 });
    expect(nextFit({ a: 0, b: FIT_MAX.b }, m())).toEqual({ a: 1, b: FIT_MAX.b });
    expect(nextFit({ a: FIT_MAX.a, b: FIT_MAX.b }, m())).toBeUndefined();
  });

  it("改ページの固定が無い一枚（共有リンク）は a と b を交互に上げる", () => {
    let l = { a: 0, b: 0 };
    const seen: string[] = [];
    for (let i = 0; i < 20; i++) {
      const n = nextFit(l, m({ hasBreak: false }));
      if (!n) break;
      l = n;
      seen.push(`${l.a}${l.b}`);
    }
    expect(seen).toEqual(["10", "11", "21", "22", "32", "33"]);
  });
});
