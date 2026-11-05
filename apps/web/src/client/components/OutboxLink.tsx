/**
 * 「依頼済み・回答待ち」の札。押すと担当者画面の送信箱へ移動して、その依頼を見せる。
 * 担当者画面の中ならそのままスクロールし、別の画面からは #/staff?outbox=… を開く。
 * デモモード（?demo=1）は、動画に映る画面を変えないため、今までどおりの押せない札にする。
 */
import { isDemoMode } from "../demo/params.ts";
import { useRoute } from "../hooks/useRoute.ts";
import { focusOutbox, outboxHash, outboxKey } from "../lib/outbox-focus.ts";

export function OutboxLink({ assetId, mitigation }: { assetId: string; mitigation: string }) {
  const [route] = useRoute();
  if (isDemoMode()) return <span className="st amber">依頼済み・回答待ち</span>;
  return (
    <button
      type="button"
      className="st amber st-link"
      title="送信箱を開く"
      aria-label="依頼済み・回答待ち。送信箱を開く"
      onClick={() => {
        if (route === "staff") focusOutbox(outboxKey(assetId, mitigation));
        else location.hash = outboxHash(assetId, mitigation);
      }}
    >
      依頼済み・回答待ち <span aria-hidden="true">›</span>
    </button>
  );
}
