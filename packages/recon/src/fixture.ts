/**
 * 記録した応答（fixture）の再生。テストとデモで使う。実ネットワークには出ない。
 * fixture の形：examples/recon/demo-seiko.example.json を参照
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { repoRoot } from "./cache.ts";
import type { CtLogSource, DnsResolver, ReconSources } from "./sources.ts";
import { CtCertificate, Hostname, MxRecord } from "./types.ts";

export const FixtureDnsRecords = z.object({
  TXT: z.array(z.string()).optional(),
  MX: z.array(MxRecord).optional(),
  A: z.array(z.string()).optional(),
  AAAA: z.array(z.string()).optional(),
  CNAME: z.array(z.string()).optional(),
});

export const ReconFixture = z.object({
  $comment: z.string().optional(),
  domain: Hostname,
  recordedAt: z.string(),
  /** 所有確認に使うトークン（fixture の TXT に同じ値を入れておく） */
  verificationToken: z.string().optional(),
  /** 名前ごとの DNS レコード。載っていない名前は NXDOMAIN 扱い */
  dns: z.record(z.string(), FixtureDnsRecords),
  /** 逆引き（IP → ホスト名） */
  ptr: z.record(z.string(), z.array(z.string())).optional(),
  ct: z.array(CtCertificate),
});
export type ReconFixture = z.infer<typeof ReconFixture>;

export class FixtureDnsResolver implements DnsResolver {
  private readonly fixture: ReconFixture;
  constructor(fixture: ReconFixture) {
    this.fixture = fixture;
  }

  private records(name: string) {
    return this.fixture.dns[name.toLowerCase().replace(/\.$/, "")];
  }
  async resolveTxt(name: string): Promise<string[]> {
    return this.records(name)?.TXT ?? [];
  }
  async resolveMx(name: string): Promise<MxRecord[]> {
    return this.records(name)?.MX ?? [];
  }
  async resolve4(name: string): Promise<string[]> {
    return this.records(name)?.A ?? [];
  }
  async resolve6(name: string): Promise<string[]> {
    return this.records(name)?.AAAA ?? [];
  }
  async resolveCname(name: string): Promise<string[]> {
    return this.records(name)?.CNAME ?? [];
  }
  async resolvePtr(ip: string): Promise<string[]> {
    return this.fixture.ptr?.[ip] ?? [];
  }
}

export class FixtureCtSource implements CtLogSource {
  private readonly fixture: ReconFixture;
  constructor(fixture: ReconFixture) {
    this.fixture = fixture;
  }
  async listCertificates(domain: string): Promise<CtCertificate[]> {
    if (domain.toLowerCase() !== this.fixture.domain) return [];
    return this.fixture.ct;
  }
}

export function loadFixture(path: string): ReconFixture {
  return ReconFixture.parse(JSON.parse(readFileSync(path, "utf8")));
}

export function fixtureSources(fixture: ReconFixture): ReconSources {
  return { resolver: new FixtureDnsResolver(fixture), ct: new FixtureCtSource(fixture) };
}

/** デモ用の架空ドメイン demo-seiko.example の fixture */
export const demoFixturePath = join(repoRoot, "examples", "recon", "demo-seiko.example.json");
export function loadDemoFixture(): ReconFixture {
  return loadFixture(demoFixturePath);
}
