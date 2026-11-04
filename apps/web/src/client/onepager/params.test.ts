import { describe, expect, it } from "vitest";
import { parseOnePagerHash, withRewrite } from "./params.ts";

describe("一枚の URL の指定", () => {
  it("generate=1 のときだけ「押さずに作る」。既定では付かない（ふだんはボタンを押すまで何も送らない）", () => {
    expect(parseOnePagerHash("#/onepager").generate).toBeUndefined();
    expect(parseOnePagerHash("#/onepager?profile=demo-seiko&case=ipa-case-1").generate).toBe(
      undefined,
    );
    expect(parseOnePagerHash("#/onepager?generate=1").generate).toBe(true);
    expect(parseOnePagerHash("#/onepager?generate=0").generate).toBeUndefined();
  });
  it("rewrite は既定が Claude、rewrite=0 がテンプレート。withRewrite で付け替えられる", () => {
    expect(parseOnePagerHash("#/onepager").rewrite).toBe(true);
    expect(parseOnePagerHash("#/onepager?rewrite=0").rewrite).toBe(false);
    expect(withRewrite("#/onepager", false)).toBe("#/onepager?rewrite=0");
    expect(withRewrite("#/onepager?rewrite=0", true)).toBe("#/onepager");
  });
});
