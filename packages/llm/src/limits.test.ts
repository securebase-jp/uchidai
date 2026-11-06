/**
 * セキュリティ診断（SEC-006・008・009）：同時実行の上限、IPv4 互換アドレス、応答の打ち切り
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_BYTES, isPrivateIp, readLimitedText } from "./article.ts";
import { positiveIntFromEnv, Semaphore } from "./limits.ts";

describe("Semaphore", () => {
  it("max を超えた分は待ち、枠が空くと順に動く", async () => {
    const s = new Semaphore(2);
    let running = 0;
    let peak = 0;
    const work = () =>
      s.run(async () => {
        running++;
        peak = Math.max(peak, running);
        await new Promise((r) => setTimeout(r, 5));
        running--;
      });
    await Promise.all([work(), work(), work(), work(), work()]);
    expect(peak).toBe(2);
    expect(s.inUse).toBe(0);
  });
  it("環境変数の正の整数だけを採り、無ければ既定", () => {
    process.env.UCHIDAI_TEST_LIMIT = "4";
    expect(positiveIntFromEnv("UCHIDAI_TEST_LIMIT", 3)).toBe(4);
    process.env.UCHIDAI_TEST_LIMIT = "0";
    expect(positiveIntFromEnv("UCHIDAI_TEST_LIMIT", 3)).toBe(3);
    process.env.UCHIDAI_TEST_LIMIT = "abc";
    expect(positiveIntFromEnv("UCHIDAI_TEST_LIMIT", 3)).toBe(3);
    delete process.env.UCHIDAI_TEST_LIMIT;
    expect(positiveIntFromEnv("UCHIDAI_TEST_LIMIT", 3)).toBe(3);
  });
});

describe("IPv4 互換アドレス（::/96）と既定の上限", () => {
  it("::7f00:1（127.0.0.1）と ::a00:1（10.0.0.1）は内部、::5db8:d822（93.184.216.34）は公開", () => {
    expect(isPrivateIp("::7f00:1")).toBe(true);
    expect(isPrivateIp("::a00:1")).toBe(true);
    expect(isPrivateIp("::5db8:d822")).toBe(false);
    expect(isPrivateIp("::")).toBe(true);
    expect(isPrivateIp("::1")).toBe(true);
  });
  it("記事の取得と PDF の既定の上限は 5MB", () => {
    expect(DEFAULT_MAX_BYTES).toBe(5 * 1024 * 1024);
  });
});

describe("readLimitedText（KEV の応答）", () => {
  it("content-length と受信量の両方で打ち切る", async () => {
    expect(await readLimitedText(new Response("{}"), 100, "大きすぎる")).toBe("{}");
    await expect(
      readLimitedText(
        new Response("x", { headers: { "content-length": "999" } }),
        100,
        "大きすぎる",
      ),
    ).rejects.toThrow("大きすぎる");
    await expect(readLimitedText(new Response("z".repeat(200)), 100, "大きすぎる")).rejects.toThrow(
      "大きすぎる",
    );
  });
});
