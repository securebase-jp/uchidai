import { describe, expect, it } from "vitest";
import { getHint, parseHints, withHint } from "./choice-hints.ts";

describe("choice-hints（件数の区分と要配慮の「分からない」をこのブラウザに覚える）", () => {
  it("書き込み → 読み出し。空になったら資産もカルテの枠も消える", () => {
    let s = withHint({}, "p1", "mail", { bucket: "gt10k" });
    s = withHint(s, "p1", "mail", { sensitiveUnknown: true });
    expect(getHint(s, "p1", "mail")).toEqual({ bucket: "gt10k", sensitiveUnknown: true });
    s = withHint(s, "p1", "mail", { bucket: undefined, sensitiveUnknown: undefined });
    expect(s).toEqual({});
  });
  it("資産ごと消す。別のカルテ、別の資産には触らない", () => {
    let s = withHint({}, "p1", "mail", { bucket: "le100" });
    s = withHint(s, "p2", "mail", { bucket: "gt100k" });
    s = withHint(s, "p1", "files", { sensitiveUnknown: true });
    s = withHint(s, "p1", "mail", undefined);
    expect(s).toEqual({
      p1: { files: { sensitiveUnknown: true } },
      p2: { mail: { bucket: "gt100k" } },
    });
  });
  it("元の store は変えない", () => {
    const a = withHint({}, "p1", "mail", { bucket: "le100" });
    withHint(a, "p1", "mail", { bucket: "gt1000" });
    expect(a).toEqual({ p1: { mail: { bucket: "le100" } } });
  });
  it("壊れた保存値や知らない区分は捨てて読む", () => {
    expect(parseHints(null)).toEqual({});
    expect(parseHints("{")).toEqual({});
    expect(parseHints("[]")).toEqual({});
    expect(
      parseHints(
        JSON.stringify({
          p1: {
            mail: { bucket: "gt1000", sensitiveUnknown: true },
            files: { bucket: "bogus" },
            x: 3,
          },
        }),
      ),
    ).toEqual({ p1: { mail: { bucket: "gt1000", sensitiveUnknown: true } } });
  });
});
