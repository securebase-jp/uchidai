import { afterEach, describe, expect, it, vi } from "vitest";
import { logError, publicMessage, redactUrls } from "./errors.ts";

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

describe("ログの URL の伏せ（SEC-015）", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });
  it("ホスト名だけ残し、パス・クエリ・ユーザー情報を伏せる", () => {
    expect(
      redactUrls("取得に失敗: https://user:pw@news.example.jp/a/b?id=7#x と http://h.example"),
    ).toBe("取得に失敗: https://news.example.jp/[省略] と http://h.example");
  });
  it("既定は例外をそのまま出す", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const e = new Error("fetch https://news.example.jp/a?b=1 failed");
    logError("[api]", e);
    expect(spy).toHaveBeenCalledWith("[api]", e);
  });
  it("UCHIDAI_LOG_REDACT_URLS=1 なら、cause も含めて URL を伏せた文で出す", () => {
    vi.stubEnv("UCHIDAI_LOG_REDACT_URLS", "1");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logError(
      "[api]",
      new Error("fetch https://news.example.jp/a?b=1 failed", {
        cause: new Error("GET https://cdn.example.jp/x/y 502"),
      }),
    );
    const out = String(spy.mock.calls[0]?.[1]);
    expect(out).toContain("https://news.example.jp/[省略]");
    expect(out).toContain("https://cdn.example.jp/[省略]");
    expect(out).not.toContain("b=1");
    expect(out).not.toContain("/x/y");
  });
});
