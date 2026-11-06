/**
 * Claude を呼ぶ API の、1 分あたりの回数の上限（SEC-006）。プロセス全体で数える（認証が無く手元だけで使う前提）。
 * - read：記事の読解（/api/case/read。urls の複数の読解も 1 回と数える）。既定 10 回／分（UCHIDAI_READ_PER_MINUTE）
 * - write：言い換え・依頼文・AI攻撃者・知見なし比較。既定 20 回／分（UCHIDAI_WRITE_PER_MINUTE）
 * 数えるのは、実際に Claude を呼ぶ直前だけ。記録の再生（キー無し、replay、記録済みの事例）は数えない。
 * 超えたら 429 と Retry-After（秒）。同時実行の上限は @uchidai/llm の limits.ts（待つだけで断らない）
 */
import { positiveIntFromEnv } from "@uchidai/llm";
import { ClientError } from "./errors.ts";

export type LimitKind = "read" | "write";

export class RateLimitError extends ClientError {
  readonly retryAfterSec: number;
  constructor(retryAfterSec: number) {
    super(
      429,
      `短い間に多くの要求がありました。${retryAfterSec} 秒ほど待ってから、もう一度お試しください`,
    );
    this.name = "RateLimitError";
    this.retryAfterSec = retryAfterSec;
  }
}

const WINDOW_MS = 60_000;

/** 直近 1 分の時刻を持ち、上限を超えたら断る（sliding window） */
export class RateWindow {
  readonly max: number;
  private readonly windowMs: number;
  private readonly now: () => number;
  private readonly stamps: number[] = [];
  constructor(max: number, windowMs = WINDOW_MS, now: () => number = () => Date.now()) {
    this.max = max;
    this.windowMs = windowMs;
    this.now = now;
  }

  /** 1 回分を取る。取れなければ RateLimitError */
  take(): void {
    const t = this.now();
    while (this.stamps.length > 0 && (this.stamps[0] ?? 0) <= t - this.windowMs)
      this.stamps.shift();
    if (this.stamps.length >= this.max) {
      const oldest = this.stamps[0] ?? t;
      throw new RateLimitError(Math.max(1, Math.ceil((oldest + this.windowMs - t) / 1000)));
    }
    this.stamps.push(t);
  }

  get used(): number {
    return this.stamps.length;
  }
}

export const DEFAULT_READ_PER_MINUTE = 10;
export const DEFAULT_WRITE_PER_MINUTE = 20;

export function windowsFromEnv(): Record<LimitKind, RateWindow> {
  return {
    read: new RateWindow(positiveIntFromEnv("UCHIDAI_READ_PER_MINUTE", DEFAULT_READ_PER_MINUTE)),
    write: new RateWindow(positiveIntFromEnv("UCHIDAI_WRITE_PER_MINUTE", DEFAULT_WRITE_PER_MINUTE)),
  };
}

let windows = windowsFromEnv();

/** Claude を呼ぶ直前に 1 回分を取る。上限を超えていれば RateLimitError（429） */
export function takeClaudeSlot(kind: LimitKind): void {
  windows[kind].take();
}

/** テスト用：窓を作り直す */
export function resetClaudeLimits(next: Partial<Record<LimitKind, RateWindow>> = {}): void {
  windows = { ...windowsFromEnv(), ...next };
}
