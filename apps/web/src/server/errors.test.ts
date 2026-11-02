import { describe, expect, it } from "vitest";
import { publicMessage } from "./errors.ts";

describe("publicMessage", () => {
  it("Error 以外や空は一般的な文言", () => {
    expect(publicMessage("x")).toBe("サーバ側でエラーが起きました");
    expect(publicMessage(new Error(""))).toBe("サーバ側でエラーが起きました");
  });
  it("絶対パス・キー・環境変数の値は出さない", () => {
    const m = publicMessage(
      new Error(
        "ENOENT: no such file or directory, open '/Users/dev/uchidai/knowledge/labels.ja.yaml'",
      ),
    );
    expect(m).not.toContain("/Users/");
    expect(m).toContain("[パス]");
    expect(publicMessage(new Error("auth sk-ant-api03-abcdefghijklmnop failed"))).not.toContain(
      "sk-ant",
    );
    expect(publicMessage(new Error("ANTHROPIC_API_KEY=abc is bad"))).not.toContain("abc");
    expect(publicMessage(new Error("C:\\Users\\dev\\secret\\x.txt"))).not.toContain("Users");
  });
  it("長すぎる文は切る", () => {
    expect(publicMessage(new Error("あ".repeat(1000))).length).toBeLessThanOrEqual(300);
  });
  it("普通の日本語の理由はそのまま", () => {
    expect(
      publicMessage(new Error("取得に失敗しました: 404 Not Found (https://x.example/a)")),
    ).toBe("取得に失敗しました: 404 Not Found (https://x.example/a)");
  });
});
