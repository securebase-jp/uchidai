import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProgressRing, ringSegments } from "./ProgressRing.tsx";

const p = { total: 20, unknown: 4, external: 6, vendor: 4, registered: 6, other: 0 };

describe("ProgressRing（確認の進み具合）", () => {
  it("根拠の内訳と未確認を輪の順に並べる（確認済みは総数から未確認を引いた数）", () => {
    const segs = ringSegments(p);
    expect(segs.map((s) => [s.key, s.count])).toEqual([
      ["external", 6],
      ["vendor", 4],
      ["registered", 6],
      ["other", 0],
      ["unknown", 4],
    ]);
    expect(segs.reduce((n, s) => n + s.count, 0)).toBe(p.total);
  });
  it("確認済み N / 全 M と未確認の件数、根拠の凡例を文字でも出す。色だけに頼らない", () => {
    const m = renderToStaticMarkup(createElement(ProgressRing, { progress: p, onJump: () => {} }));
    expect(m).toContain("確認の進み具合：全 20 件のうち 16 件が確認済み、未確認 4 件");
    expect(m).toContain(">16<");
    expect(m).toContain("/ 20");
    expect(m).toContain("未確認 4 件");
    for (const label of ["外部確認", "ベンダー回答", "担当者登録"]) expect(m).toContain(label);
    expect(m).not.toContain("根拠なし");
    // 輪は 3 色の弧（外部確認・ベンダー回答・担当者登録）と未確認の弧
    expect((m.match(/stroke-dasharray/g) ?? []).length).toBe(4);
  });
  it("未確認が 0 なら押せない（移る先が無い）", () => {
    const m = renderToStaticMarkup(
      createElement(ProgressRing, {
        progress: { ...p, unknown: 0, registered: 10 },
        onJump: () => {},
      }),
    );
    expect(m).toMatch(/<button[^>]*disabled/);
    expect(m).toContain("未確認 0 件");
  });
  it("緩和策が無い（0 件）でも崩れない", () => {
    const m = renderToStaticMarkup(
      createElement(ProgressRing, {
        progress: { total: 0, unknown: 0, external: 0, vendor: 0, registered: 0, other: 0 },
        onJump: () => {},
      }),
    );
    expect(m).toContain("/ 0");
    expect(m).not.toContain("stroke-dasharray");
  });
});
