/**
 * 応答のキャッシュ。crt.sh へ同じ問い合わせを繰り返さないため、既定でディスクに 24 時間保存する。
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ReconCache } from "./sources.ts";

export const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
export const repoRoot = join(packageRoot, "..", "..");
/** 既定のキャッシュ置き場（packages/recon/.cache。gitignore 済み） */
export const defaultCacheDir = join(packageRoot, ".cache");

export class MemoryCache implements ReconCache {
  private readonly store = new Map<string, string>();
  async get(key: string): Promise<string | undefined> {
    return this.store.get(key);
  }
  async set(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
}

interface Envelope {
  storedAt: string;
  value: string;
}

export class FileCache implements ReconCache {
  constructor(
    private readonly dir: string = defaultCacheDir,
    private readonly ttlMs: number = 24 * 60 * 60 * 1000,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private pathFor(key: string): string {
    const digest = createHash("sha256").update(key).digest("hex").slice(0, 32);
    return join(this.dir, `${digest}.json`);
  }

  async get(key: string): Promise<string | undefined> {
    try {
      const raw = await readFile(this.pathFor(key), "utf8");
      const envelope = JSON.parse(raw) as Envelope;
      const age = this.now().getTime() - new Date(envelope.storedAt).getTime();
      if (Number.isNaN(age) || age > this.ttlMs) return undefined;
      return envelope.value;
    } catch {
      return undefined;
    }
  }

  async set(key: string, value: string): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const envelope: Envelope = { storedAt: this.now().toISOString(), value };
    await writeFile(this.pathFor(key), JSON.stringify(envelope), "utf8");
  }
}
