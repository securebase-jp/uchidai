/**
 * Node 標準の dns/promises による DNS 参照。問い合わせ先は DNS サーバだけで、対象ホストにはつながない。
 * 名前が無い（ENOTFOUND）、レコードが無い（ENODATA）は空配列。それ以外の失敗は例外のまま返す。
 */
import { Resolver } from "node:dns/promises";
import type { DnsResolver } from "./sources.ts";
import type { MxRecord } from "./types.ts";

const ABSENT = new Set(["ENOTFOUND", "ENODATA"]);

async function absentAsEmpty<T>(work: () => Promise<T[]>): Promise<T[]> {
  try {
    return await work();
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code && ABSENT.has(code)) return [];
    throw error;
  }
}

export class NodeDnsResolver implements DnsResolver {
  private readonly resolver: Resolver;

  constructor(options: { servers?: string[]; timeoutMs?: number } = {}) {
    this.resolver = new Resolver({ timeout: options.timeoutMs ?? 5_000, tries: 2 });
    if (options.servers) this.resolver.setServers(options.servers);
  }

  async resolveTxt(name: string): Promise<string[]> {
    const chunks = await absentAsEmpty(() => this.resolver.resolveTxt(name));
    return chunks.map((parts) => parts.join(""));
  }

  async resolveMx(name: string): Promise<MxRecord[]> {
    const records = await absentAsEmpty(() => this.resolver.resolveMx(name));
    return records.map((r) => ({ exchange: r.exchange.toLowerCase(), priority: r.priority }));
  }

  resolve4(name: string): Promise<string[]> {
    return absentAsEmpty(() => this.resolver.resolve4(name));
  }

  resolve6(name: string): Promise<string[]> {
    return absentAsEmpty(() => this.resolver.resolve6(name));
  }

  async resolveCname(name: string): Promise<string[]> {
    const names = await absentAsEmpty(() => this.resolver.resolveCname(name));
    return names.map((n) => n.toLowerCase());
  }

  async resolvePtr(ip: string): Promise<string[]> {
    const names = await absentAsEmpty(() => this.resolver.reverse(ip));
    return names.map((n) => n.toLowerCase());
  }
}
