/**
 * 舞台を画面に合わせる倍率の計算（社長画面）。
 * 幅に合う倍率と高さに合う倍率の小さいほうを取り、1 を超えない（1920×1080 では等倍）。
 */

/** 手動の倍率の範囲と刻み */
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 1.5;
export const ZOOM_STEP = 0.1;

export function fitScale(availW: number, availH: number, w: number, h: number): number {
  if (w <= 0 || h <= 0) return 1;
  const s = Math.min(availW / w, availH / h, 1);
  if (!Number.isFinite(s) || s <= 0) return 1;
  // 0.05 未満の違いで揺れないよう、千分の一に丸める
  return Math.max(0.1, Math.round(s * 1000) / 1000);
}

/** 手動の倍率を一段進める（0.5〜1.5、0.1 刻み。浮動小数の誤差を丸める） */
export function stepZoom(current: number, dir: 1 | -1): number {
  const next = Math.round((current + dir * ZOOM_STEP) * 10) / 10;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
}
