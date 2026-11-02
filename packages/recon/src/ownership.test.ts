import { describe, expect, it } from "vitest";
import { MemoryCache } from "./cache.ts";
import { CrtShSource } from "./crtsh.ts";
import { NodeDnsResolver } from "./dns-node.ts";
import { fixtureSources, loadDemoFixture } from "./fixture.ts";
import {
  assertVerified,
  generateVerificationToken,
  isLiveResolver,
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

describe("所有確認の入力の検証と失敗理由", () => {
  it("ドメインとして扱えない入力は例外にせず、日本語の理由を返す", async () => {
    for (const bad of [
      "localhost",
      "203.0.113.10",
      "10.in-addr.arpa",
      "exa mple.jp",
      "",
      "例.jp",
    ]) {
      const check = await verifyOwnership(bad, token, { resolver });
      expect(check.ok, bad).toBe(false);
      if (!check.ok) expect(check.reasonJa).toMatch(/ドメイン名として扱えない/);
    }
  });
  it("DNS の参照に失敗したら例外にせず、日本語の理由を返す", async () => {
    const broken = {
      ...resolver,
      resolveTxt: async () => {
        throw new Error("ETIMEOUT");
      },
    };
    const check = await verifyOwnership(domain, token, { resolver: broken });
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reasonJa).toContain("参照できなかった");
  });
  it("TXT の値は引用符と前後の空白を外して比べ、他サービスの値が並んでいても通る", async () => {
    const quoted = {
      ...resolver,
      resolveTxt: async () => ["MS=ms123", ` "uchidai-verify=${token}" `, "v=spf1 -all"],
    };
    const check = await verifyOwnership(domain, token, { resolver: quoted });
    expect(check.ok).toBe(true);
  });
});

describe("所有確認の有効期限", () => {
  it("24 時間を超えた確認結果では recon を実行しない（再確認が必要）", async () => {
    const check = await verifyOwnership(domain, token, {
      resolver,
      now: () => new Date("2026-11-01T08:00:00Z"),
    });
    if (!check.ok) throw new Error(check.reasonJa);
    await expect(
      recon(domain, {
        ownership: check.verified,
        resolver,
        ct,
        now: () => new Date("2026-11-02T09:00:00Z"),
      }),
    ).rejects.toThrow(/再確認/);
    // 期限内なら通る
    const result = await recon(domain, {
      ownership: check.verified,
      resolver,
      ct,
      now: () => new Date("2026-11-02T07:00:00Z"),
    });
    expect(result.domain).toBe(domain);
  });
  it("assertVerified は verifiedAt が読めない確認結果を拒否する", async () => {
    const check = await verifyOwnership(domain, token, { resolver });
    if (!check.ok) throw new Error(check.reasonJa);
    const tampered = Object.assign(Object.create(null), check.verified, { verifiedAt: "いつか" });
    expect(() => assertVerified(domain, tampered)).toThrow(OwnershipNotVerifiedError);
  });
});

describe("記録（fixture）で通した所有確認で実際の参照はしない", () => {
  it("fixture の所有確認に実際の DNS（NodeDnsResolver）を組み合わせると拒否する", async () => {
    const check = await verifyOwnership(domain, token, { resolver });
    if (!check.ok) throw new Error(check.reasonJa);
    expect(check.verified.source).toBe("fixture");
    await expect(
      recon(domain, { ownership: check.verified, resolver: new NodeDnsResolver(), ct }),
    ).rejects.toThrow(/記録（fixture）/);
    await expect(
      recon(domain, {
        ownership: check.verified,
        resolver,
        ct: new CrtShSource({ cache: new MemoryCache() }),
      }),
    ).rejects.toThrow(/記録（fixture）/);
  });
  it("実際の DNS の実装（NodeDnsResolver）を渡したときだけ source が live になる", () => {
    expect(isLiveResolver(new NodeDnsResolver())).toBe(true);
    expect(isLiveResolver(resolver)).toBe(false);
  });
});
