/**
 * 続報の差分（前の報から変わったこと）と、一枚の印刷の寸法（Issue #11）。
 * - 差分は reports があるとき（API）と、changesJa を載せた共有リンクのときだけ出る。無い一枚は 1 バイトも変わらない
 * - 一枚は 2 ページ。1 枚目の余裕は最小で約 20px しかないので、差分を足す一枚は経路図の高さの上限を下げて、差分の最大の高さぶんを空ける。
 *   実際の寸法の確認（IR の複数報・デモの事故・case= の例）はブラウザで行い、ここでは CSS の約束が崩れないことを確かめる
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { app } from "../../server/app.ts";
import type { OnePagerResponse } from "../lib/api.ts";
import { sharePayloadFrom } from "../lib/onepager-share.ts";
import { OnePagerView, viewDataFromResponse, viewDataFromShare } from "./OnePagerView.tsx";

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "onepager.css"), "utf8");
const MM = 96 / 25.4;
const PT = 96 / 72;

// biome-ignore lint/suspicious/noExplicitAny: テストでは応答の形を緩く読む
type Loose = any;
const post = (path: string, body: unknown) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

async function response(withReports: boolean): Promise<OnePagerResponse> {
  const c: Loose = await (await app.request("/api/case/recorded/ipa-case-1")).json();
  const p: Loose = await (await app.request("/api/examples/demo-seiko")).json();
  const theCase = c.case;
  const reports = withReports
    ? [
        {
          label: "第1報",
          case: {
            ...theCase,
            steps: [
              { ...theCase.steps[0], certainty: "not_stated", source: "unknown" },
              ...theCase.steps.slice(1),
            ],
          },
        },
        { label: "第2報", case: theCase },
      ]
    : undefined;
  const res = await post("/api/onepager", {
    case: theCase,
    profile: p.profile,
    rewrite: false,
    ...(reports ? { reports } : {}),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as OnePagerResponse;
}

const html = (data: ReturnType<typeof viewDataFromResponse>) =>
  renderToStaticMarkup(createElement(OnePagerView, { data }));

describe("続報の差分の表示", () => {
  it("reports のある一枚だけ『前の報から変わったこと』と op-has-changes が付き、無い一枚は差分を出さない", async () => {
    const plain = html(viewDataFromResponse(await response(false)));
    expect(plain).not.toContain("前の報から変わったこと");
    expect(plain).not.toContain("op-has-changes");

    const withChanges = html(viewDataFromResponse(await response(true)));
    expect(withChanges).toContain("前の報から変わったこと");
    expect(withChanges).toContain("op-has-changes");
  });

  it("共有リンクの往復でも同じ差分が出る：API の一枚と、リンクから復元した一枚で、差分の文が同じ", async () => {
    const data = await response(true);
    expect(data.changes?.summaryJa.length).toBeGreaterThan(0);
    const payload = sharePayloadFrom(data, new Date("2026-11-07T09:00:00+09:00"));
    const shared = html(viewDataFromShare(payload));
    expect(shared).toContain("前の報から変わったこと");
    expect(shared).toContain("op-has-changes");
    for (const line of data.changes?.summaryJa ?? []) expect(shared).toContain(line);
  });

  it("差分の無いリンクから開いた一枚は、差分の節を出さない（従来のリンクと同じ）", async () => {
    const payload = sharePayloadFrom(await response(false));
    const shared = html(viewDataFromShare(payload));
    expect(shared).not.toContain("前の報から変わったこと");
    expect(shared).not.toContain("op-has-changes");
  });
});

describe("一枚の印刷の寸法（差分を足しても 2 ページ）", () => {
  const rule = (selector: string): string => {
    const i = css.indexOf(selector);
    expect(i, `${selector} が onepager.css に無い`).toBeGreaterThanOrEqual(0);
    return css.slice(i, css.indexOf("}", i));
  };
  const num = (block: string, prop: string): number => {
    const m = new RegExp(`${prop}:\\s*([0-9.]+)`).exec(block);
    expect(m, `${prop} が無い`).not.toBeNull();
    return Number(m?.[1]);
  };
  const PRINT = ":is(:root.printing, :root.print-preview, .op-capture)";

  it("差分の最大の高さ（ラベル 1 行 + 2 文 × 2 行 + 余白）は、経路図の上限を下げた分より小さい", () => {
    const changed = rule(`${PRINT} .op-changed {`);
    const label = rule(`${PRINT} .op-changed b {`);
    const span = rule(`${PRINT} .op-changed span {`);
    const lineHeight = num(changed, "line-height");
    const fontPt = num(changed, "font-size");
    const labelPt = num(label, "font-size");
    const clamp = num(span, "-webkit-line-clamp");
    expect(clamp).toBeLessThanOrEqual(2);
    const sentences = 2; // MAX_CHANGES_LINES（共有リンクの上限）と同じ
    const worst =
      num(changed, "margin-top") * MM +
      labelPt * PT * lineHeight +
      sentences * clamp * fontPt * PT * lineHeight;

    const normal = num(rule(`${PRINT} .op-figure svg.diagram {`), "max-height");
    const withChanges = num(
      rule(`${PRINT} .op-has-changes .op-figure svg.diagram {`),
      "max-height",
    );
    const reclaimed = (normal - withChanges) * MM;
    // 差分を足しても、経路図が上限の高さのとき 1 枚目の高さは増えない（空き 20px の一枚でも 2 ページに収まる）
    expect(reclaimed).toBeGreaterThanOrEqual(worst);
  });

  it("差分は印刷で改ページの途中に割れない", () => {
    expect(rule(`${PRINT} .op-changed {`)).toContain("break-inside: avoid");
  });
});
