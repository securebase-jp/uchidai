/**
 * 同じ緩和策の記録が複数あるときの、画面での見せ方。
 * カルテは 1 つの緩和策に複数の記録を持てる（外部確認が足した記録と、担当者登録の記録など。
 * packages/recon の applyAssetHints は担当者登録・ベンダー回答の記録を残す）。判定は engine の resolveControl が
 * 「確定した記録を優先、次に根拠の強さ（外部確認 ＞ ベンダー回答 ＞ 担当者登録 ＞ なし）」で 1 つに決める。
 * 画面の一覧・件数も同じ選び方で 1 緩和策 1 行にする（行の key の重複と、未確認の数え過ぎを防ぐ）
 */
import type { CompanyProfile } from "./types.ts";

type Control = CompanyProfile["assets"][number]["controls"][number];

const EVIDENCE_RANK: Record<string, number> = { external: 3, vendor: 2, registered: 1, none: 0 };

/** 緩和策ごとに 1 記録だけを残す（最初に出てきた緩和策の位置のまま。engine の resolveControl と同じ選び方） */
export function resolvedControls(controls: readonly Control[]): Control[] {
  const best = new Map<string, Control>();
  for (const c of controls) {
    const cur = best.get(c.mitigation);
    if (!cur || better(c, cur)) best.set(c.mitigation, c);
  }
  // 並びは、各緩和策が最初に現れた順
  return [...new Set(controls.map((c) => c.mitigation))].flatMap((m) => {
    const c = best.get(m);
    return c ? [c] : [];
  });
}

/** a が b より優先されるか：確定した記録（unknown でない）が先、同じなら根拠が強い方 */
function better(a: Control, b: Control): boolean {
  const ak = a.status !== "unknown";
  const bk = b.status !== "unknown";
  if (ak !== bk) return ak;
  return (EVIDENCE_RANK[a.evidence] ?? 0) > (EVIDENCE_RANK[b.evidence] ?? 0);
}
