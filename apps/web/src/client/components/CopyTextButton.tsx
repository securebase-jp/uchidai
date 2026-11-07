/**
 * 「本文をコピー」：まとめ依頼のメールは長いので、メールソフトで開く（mailto:）より、本文をコピーして貼る送り方を主にする。
 * コピーできなかったときは、本文を選んだ状態で見せ、手でコピーしてもらう。
 */
import { useRef, useState } from "react";
import { copyText } from "../lib/batchSelect.ts";

export function CopyTextButton({
  text,
  label = "本文をコピー",
  primary = true,
}: {
  text: string;
  label?: string;
  primary?: boolean;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const area = useRef<HTMLTextAreaElement>(null);

  async function copy() {
    const ok = await copyText(text);
    setState(ok ? "copied" : "failed");
    if (ok) setTimeout(() => setState("idle"), 3000);
    else setTimeout(() => area.current?.select(), 0);
  }

  return (
    <>
      <button
        type="button"
        className={`btn sm ${primary ? "primary" : ""}`}
        onClick={() => void copy()}
      >
        {state === "copied" ? "コピーしました" : label}
      </button>
      {state === "failed" && (
        <div className="copy-fallback">
          <p className="small">
            自動でコピーできませんでした。下の本文を選んで、コピーしてください。
          </p>
          <textarea
            ref={area}
            readOnly
            value={text}
            rows={8}
            aria-label="コピーする本文"
            onFocus={(e) => e.currentTarget.select()}
          />
        </div>
      )}
    </>
  );
}
