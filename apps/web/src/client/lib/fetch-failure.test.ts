import { describe, expect, it } from "vitest";
import { fetchFailureGuide, MIN_PASTE_CHARS, pastesFor, unpasted } from "./fetch-failure.ts";

const LONG = "あ".repeat(MIN_PASTE_CHARS);

describe("fetchFailureGuide（失敗の理由ごとの案内。Issue #6）", () => {
  it("理由ごとに一文が違い、どれも本文を貼る道を示す", () => {
    const texts = (["forbidden", "not_found", "empty", "bad_pdf", "other"] as const).map(
      (r) => fetchFailureGuide(r).textJa,
    );
    expect(new Set(texts).size).toBe(texts.length);
    for (const t of texts) expect(t).toMatch(/貼/);
  });
  it("本文が空・短いときは「PDF の版があればその URL」と出す（自動では探さない）", () => {
    for (const r of ["empty", "thin"] as const) {
      expect(fetchFailureGuide(r).textJa).toContain("PDF の版があればその URL");
      expect(fetchFailureGuide(r).detailJa.join("")).toContain("自動では探しません");
    }
  });
  it("理由が無い（古い応答）ときも案内を返す", () => {
    expect(fetchFailureGuide(undefined).textJa).toMatch(/貼/);
  });
});

describe("pastesFor / unpasted", () => {
  const failures = [
    { url: "https://a.test/1", message: "x" },
    { url: "https://a.test/2", message: "y" },
  ];
  it("40 字以上貼られた URL だけを差し替えに使い、残りは未対応として残す", () => {
    const pastes = { "https://a.test/1": LONG, "https://a.test/2": "短い" };
    expect(
      pastesFor(
        pastes,
        failures.map((f) => f.url),
      ),
    ).toEqual([{ url: "https://a.test/1", text: LONG }]);
    expect(unpasted(failures, pastes).map((f) => f.url)).toEqual(["https://a.test/2"]);
  });
  it("貼った本文の前後の空白は除く", () => {
    expect(pastesFor({ "https://a.test/1": `  ${LONG}\n` }, ["https://a.test/1"])[0]?.text).toBe(
      LONG,
    );
  });
});
