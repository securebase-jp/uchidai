import { describe, expect, it } from "vitest";
import { fitScale, stepZoom } from "./fit.ts";

describe("fitScale", () => {
  it("1920×1080 相当では等倍（1 を超えない）", () => {
    expect(fitScale(1760, 1000, 1320, 900)).toBe(1);
  });
  it("高さが足りないときは高さに合わせる", () => {
    expect(fitScale(1178, 600, 1178, 1200)).toBe(0.5);
  });
  it("幅と高さの小さいほうを取る", () => {
    expect(fitScale(600, 900, 1200, 1000)).toBe(0.5);
  });
  it("寸法が 0 のときは等倍", () => {
    expect(fitScale(1000, 800, 0, 0)).toBe(1);
  });
  it("極端に小さくても 0.1 を下回らない", () => {
    expect(fitScale(10, 10, 1000, 1000)).toBe(0.1);
  });
});

describe("stepZoom", () => {
  it("0.1 刻みで進み、誤差を丸める", () => {
    expect(stepZoom(1, 1)).toBe(1.1);
    expect(stepZoom(1.1, 1)).toBe(1.2);
    expect(stepZoom(0.7, -1)).toBe(0.6);
  });
  it("0.5〜1.5 の範囲に収める", () => {
    expect(stepZoom(1.5, 1)).toBe(1.5);
    expect(stepZoom(0.5, -1)).toBe(0.5);
  });
});
