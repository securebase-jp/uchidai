import { describe, expect, it } from "vitest";
import { shouldLoadDefaultCase } from "./default-case.ts";

describe("shouldLoadDefaultCase（既定の事例を読むのはデモ・録画の URL のときだけ）", () => {
  it("通常の URL では読まない", () => {
    expect(shouldLoadDefaultCase("")).toBe(false);
    expect(shouldLoadDefaultCase("?foo=1")).toBe(false);
    expect(shouldLoadDefaultCase("?demo=0&autostart=0")).toBe(false);
  });
  it("?profile=、?demo=1、?autostart=1 のどれかがあれば読む", () => {
    expect(shouldLoadDefaultCase("?profile=demo-seiko")).toBe(true);
    expect(shouldLoadDefaultCase("?demo=1")).toBe(true);
    expect(shouldLoadDefaultCase("?autostart=1")).toBe(true);
    expect(shouldLoadDefaultCase("?profile=demo-seiko&demo=1&autostart=1&hud=1")).toBe(true);
  });
});
