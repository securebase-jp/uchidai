/**
 * プロセス内の同時実行の上限（SEC-006）。Claude の呼び出しと記事の取得が、同時に際限なく走らないようにする。
 * 上限を超えた分は待つ（断らない）。回数の上限（1 分あたり）はサーバ側（apps/web/src/server/limits.ts）が 429 で断る
 */

// 注意：パラメータプロパティ（constructor(readonly x)）は Node の型ストリップでは動かないので使わない
export class Semaphore {
  readonly max: number;
  private active = 0;
  private readonly waiting: (() => void)[] = [];
  constructor(max: number) {
    this.max = max;
  }

  get inUse(): number {
    return this.active;
  }

  async acquire(): Promise<() => void> {
    if (this.active < this.max) {
      this.active++;
    } else {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
      this.active++;
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
      this.waiting.shift()?.();
    };
  }

  /** work を 1 枠の中で動かす */
  async run<T>(work: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await work();
    } finally {
      release();
    }
  }
}

/** 環境変数の正の整数（無い・不正なら既定） */
export function positiveIntFromEnv(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isInteger(v) && v > 0 ? v : fallback;
}

/** Claude の同時呼び出し数（既定 3。UCHIDAI_CLAUDE_CONCURRENCY） */
export const claudeSemaphore = new Semaphore(positiveIntFromEnv("UCHIDAI_CLAUDE_CONCURRENCY", 3));
/** 記事の取得の同時数（既定 3。UCHIDAI_FETCH_CONCURRENCY） */
export const fetchSemaphore = new Semaphore(positiveIntFromEnv("UCHIDAI_FETCH_CONCURRENCY", 3));
