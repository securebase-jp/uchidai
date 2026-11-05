/**
 * 「依頼済み・回答待ち」の札から、担当者画面の送信箱へ移動して、その依頼を見せる。
 * 伝え方はハッシュのクエリ：#/staff?outbox=<資産 id>:<対策 id>（画面の切り替えは今までどおりハッシュ）。
 * 動きを減らす設定（OS／画面）のときは、滑らかなスクロールも使わず、枠だけを付ける。
 */

/** 依頼を指す印（資産 id と対策 id） */
export const outboxKey = (assetId: string, mitigation: string): string =>
  `${assetId}:${mitigation}`;

export const outboxHash = (assetId: string, mitigation: string): string =>
  `/staff?outbox=${encodeURIComponent(outboxKey(assetId, mitigation))}`;

/** ハッシュの outbox= を読む。無ければ undefined */
export function parseOutboxParam(hash: string): string | undefined {
  const q = hash.split("?")[1];
  if (q === undefined) return undefined;
  const v = new URLSearchParams(q).get("outbox");
  return v ? v : undefined;
}

/** 動きを減らす設定か（画面の設定が OS の設定に優先する） */
export function prefersReducedMotion(): boolean {
  const attr =
    typeof document === "undefined" ? undefined : document.documentElement.dataset.reduced;
  if (attr === "true") return true;
  if (attr === "false") return false;
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export const OUTBOX_HIT_CLASS = "outbox-hit";
const HIT_MS = 3500;

/**
 * 送信箱へスクロールして、key の依頼を数秒だけ目立たせる。
 * 依頼が見つからない（0 件・回答済みなど）ときは、確認依頼パネルの先頭へ。
 * 戻り値は、見つけた依頼の要素（なければ undefined）
 */
export function focusOutbox(key?: string, root: ParentNode = document): HTMLElement | undefined {
  const behavior: ScrollBehavior = prefersReducedMotion() ? "auto" : "smooth";
  const hit =
    key === undefined
      ? undefined
      : Array.from(root.querySelectorAll<HTMLElement>("[data-outbox-key]")).find(
          (el) => el.dataset.outboxKey === key,
        );
  if (hit) {
    hit.scrollIntoView({ behavior, block: "center" });
    hit.classList.add(OUTBOX_HIT_CLASS);
    setTimeout(() => hit.classList.remove(OUTBOX_HIT_CLASS), HIT_MS);
    return hit;
  }
  const panel = root.querySelector<HTMLElement>("[data-outbox-box]");
  (panel ?? root.querySelector<HTMLElement>("#staff-requests"))?.scrollIntoView({
    behavior,
    block: "start",
  });
  return undefined;
}
