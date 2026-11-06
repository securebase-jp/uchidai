/**
 * セキュリティ診断（SEC-009）：証明書の公開ログの応答を、content-length と受信量で打ち切る
 */
import { describe, expect, it } from "vitest";
import { MAX_RESPONSE_BYTES, ResponseTooLargeError, readLimitedText } from "./safe-fetch.ts";

describe("readLimitedText", () => {
  it("上限以下の本文はそのまま読める。既定の上限は 10MB", async () => {
    expect(await readLimitedText(new Response("[]"), 100)).toBe("[]");
    expect(MAX_RESPONSE_BYTES).toBe(10 * 1024 * 1024);
  });
  it("content-length が上限を超えていれば本文を読まずに止める", async () => {
    const res = new Response("x", { headers: { "content-length": "1000" } });
    await expect(readLimitedText(res, 100)).rejects.toBeInstanceOf(ResponseTooLargeError);
  });
  it("宣言が無くても受信量で打ち切る", async () => {
    const chunk = new TextEncoder().encode("y".repeat(64));
    const stream = new ReadableStream<Uint8Array>({
      pull(ctrl) {
        ctrl.enqueue(chunk);
      },
    });
    await expect(readLimitedText(new Response(stream), 1000)).rejects.toBeInstanceOf(
      ResponseTooLargeError,
    );
  });
});
