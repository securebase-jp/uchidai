/**
 * 取得できなかった公表の一覧（URL と理由）と、一つずつ「本文を貼る」で差し替える入口。
 * 担当者画面（読めた分だけで読んだあと）と、記事の入力（複数の URL を読んで失敗したとき）の両方で使う。
 * 貼った本文は、取得に行かず、その URL の本文としてそのまま読む（新しい外部アクセスは増えない）
 */
import { useEffect, useRef, useState } from "react";
import type { SeriesFailure } from "../../shared/api.ts";
import { fetchFailureGuide, MIN_PASTE_CHARS } from "../lib/fetch-failure.ts";
import { InfoButton } from "./InfoButton.tsx";

type Props = {
  failures: SeriesFailure[];
  /** URL ごとの、貼られた本文 */
  pastes: Readonly<Record<string, string>>;
  onPaste(url: string, text: string): void;
  disabled?: boolean;
};

export function FetchFailures({ failures, pastes, onPaste, disabled }: Props) {
  const [open, setOpen] = useState<string>();
  const box = useRef<HTMLTextAreaElement>(null);
  // 貼る欄を開いたら、そこへフォーカスを移す
  // biome-ignore lint/correctness/useExhaustiveDependencies: 開いたとき（open が変わったとき）だけ移す
  useEffect(() => {
    if (open) box.current?.focus();
  }, [open]);
  return (
    <div className="fetch-failures">
      <div className="small">
        取得できなかった公表があります。
        <InfoButton title="取得できなかったとき">
          <p>
            サイトが自動での取得を断る、ページが見つからない、本文が空、などの理由で、読めなかった公表です。読めた分だけで、事故の経路は読んでいます。
          </p>
          <p>
            失敗した公表は、ブラウザで開いて本文をコピーし、「本文を貼る」から一つずつ差し替えられます。貼った本文は、取得を介さず、そのまま読みます。PDF
            の版があるときは、その URL に差し替えても構いません（自動では探しません）。
          </p>
        </InfoButton>
      </div>
      <ul className="small series-failures">
        {failures.map((f) => {
          const pasted = (pastes[f.url]?.trim().length ?? 0) >= MIN_PASTE_CHARS;
          const guide = fetchFailureGuide(f.reason);
          return (
            <li key={f.url}>
              <code>{f.url}</code>　{f.message}
              <div className="row" style={{ marginTop: 4 }}>
                {pasted ? (
                  <span className="muted">貼り付け済み（{pastes[f.url]?.trim().length} 字）</span>
                ) : null}
                <button
                  type="button"
                  className="btn sm"
                  disabled={disabled}
                  aria-expanded={open === f.url}
                  onClick={() => setOpen(open === f.url ? undefined : f.url)}
                >
                  {pasted ? "貼った本文を直す" : "本文を貼る"}
                </button>
              </div>
              {open === f.url && (
                <div className="stack" style={{ marginTop: 4 }}>
                  <p className="muted">{guide.textJa}</p>
                  <textarea
                    ref={box}
                    className="in"
                    placeholder={`この公表の本文を貼り付け（${MIN_PASTE_CHARS} 文字以上）`}
                    value={pastes[f.url] ?? ""}
                    onChange={(e) => onPaste(f.url, e.target.value)}
                    disabled={disabled}
                    aria-label={`本文を貼る：${f.url}`}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
