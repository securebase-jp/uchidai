import { describe, expect, it } from "vitest";
import { fixtureSources, loadDemoFixture } from "./fixture.ts";
import {
  assertVerified,
  generateVerificationToken,
  isVerifiedDomain,
  OwnershipNotVerifiedError,
  verificationInstructionsJa,
  verificationRecord,
  verifyOwnership,
} from "./ownership.ts";
import { recon } from "./recon.ts";

const fixture = loadDemoFixture();
const { resolver, ct } = fixtureSources(fixture);
const domain = fixture.domain;
const token = fixture.verificationToken ?? "";

describe("所有確認のトークン", () => {
  it("32 文字の 16 進数を生成し、TXT の値は uchidai-verify= で始まる", () => {
    const t = generateVerificationToken();
    expect(t).toMatch(/^[0-9a-f]{32}$/);
    expect(verificationRecord(t)).toBe(`uchidai-verify=${t}`);
    expect(generateVerificationToken()).not.toBe(t);
  });
  it("形式が不正なトークンは拒否する", () => {
    expect(() => verificationRecord("short")).toThrow();
    expect(() => verificationRecord("has space in the token value")).toThrow();
  });
  it("手順はドメインと値を含む日本語", () => {
    const lines = verificationInstructionsJa("Example.JP.", "0123456789abcdef0123456789abcdef");
    expect(lines.join("\n")).toContain("example.jp");
    expect(lines.join("\n")).toContain("uchidai-verify=0123456789abcdef0123456789abcdef");
  });
});

describe("verifyOwnership", () => {
  it("fixture の TXT にトークンがあれば通る", async () => {
    const check = await verifyOwnership(domain, token, { resolver });
    expect(check.ok).toBe(true);
    if (check.ok) {
      expect(check.verified.domain).toBe(domain);
      expect(check.verified.record).toBe(`uchidai-verify=${token}`);
      expect(check.verified.source).toBe("fixture");
      expect(isVerifiedDomain(check.verified)).toBe(true);
    }
  });
  it("トークンが違えば通らず、理由と見つかった TXT を返す", async () => {
    const check = await verifyOwnership(domain, "wrong-token-wrong-token-0000", { resolver });
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.reasonJa).toContain("一致しない");
      expect(check.txtRecords.length).toBeGreaterThan(0);
    }
  });
  it("TXT が無いドメインは通らない", async () => {
    const check = await verifyOwnership("other-company.example", token, { resolver });
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reasonJa).toContain("見つからない");
  });
  it("大文字や末尾のドットは正規化する", async () => {
    const check = await verifyOwnership("DEMO-SEIKO.example.", token, { resolver });
    expect(check.ok).toBe(true);
  });
});

describe("所有確認なしの実行は拒否する", () => {
  it("同じ形のオブジェクトを作っても VerifiedDomain として通らない", () => {
    const forged = {
      domain,
      record: `uchidai-verify=${token}`,
      verifiedAt: new Date().toISOString(),
      source: "fixture",
    };
    expect(isVerifiedDomain(forged)).toBe(false);
    expect(() => assertVerified(domain, forged)).toThrow(OwnershipNotVerifiedError);
  });
  it("recon は確認結果が無いと例外、別ドメインの確認結果でも例外", async () => {
    await expect(
      recon(domain, { ownership: undefined as never, resolver, ct }),
    ).rejects.toBeInstanceOf(OwnershipNotVerifiedError);
    const check = await verifyOwnership(domain, token, { resolver });
    if (!check.ok) throw new Error("fixture の所有確認が通らない");
    await expect(
      recon("other-company.example", { ownership: check.verified, resolver, ct }),
    ).rejects.toThrow(/別のドメイン/);
  });
});
