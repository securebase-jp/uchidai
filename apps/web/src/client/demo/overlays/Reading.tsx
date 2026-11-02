/**
 * 記事リンクの貼り付け → 読解結果（場面 3）。
 * 入力欄に URL を打ち、「読む」を押し、記録済みの Case を「記載／推定／不明」のタグと手法 ID つきで並べる。
 * Claude は呼ばない（記録済みの読解結果を再生する）。
 */
import { useApp } from "../../hooks/useApp.tsx";

const URL = "https://www.ipa.go.jp/security/reports/sme/rcu1hd0000009k82-att/sme-jirei.pdf";
const SOURCE_JA = { stated: "記載", inferred: "推定", unknown: "不明" } as const;
const T_TYPE = 0.4;
const T_PRESS = 4.6;
const T_RESULT = 6.4;

export function ReadingOverlay({ elapsed }: { elapsed: number; seconds: number }) {
  const app = useApp();
  const c = app.theCase;
  const labels = app.knowledge?.labels;
  const typedUrl =
    elapsed < T_TYPE ? "" : URL.slice(0, Math.min(URL.length, Math.floor((elapsed - T_TYPE) * 24)));
  const pressed = elapsed >= T_PRESS;
  const showResult = elapsed >= T_RESULT && c;
  const rows = c?.steps ?? [];

  return (
    <div className="demo-overlay reading" role="dialog" aria-label="記事の読解（演出）">
      <div className="reading-window">
        <div className="reading-head">
          <span>記事の URL か本文を貼って、読ませる</span>
          <span className="mono muted">
            記録済みの読解結果を再生（{app.caseMeta?.recorded?.model ?? "claude"}）
          </span>
        </div>
        <div className="reading-row">
          <div className={`reading-input${typedUrl ? " on" : ""}`}>
            {typedUrl || <span className="muted">https://…（報道記事や公的機関の事例の URL）</span>}
            {!pressed && typedUrl && <span className="chat-caret" aria-hidden="true" />}
          </div>
          <button type="button" className={`btn primary${pressed ? " pressed" : ""}`} tabIndex={-1}>
            URL を読む
          </button>
        </div>
        {pressed && !showResult && (
          <p className="reading-wait">
            <span className="chat-typing">
              <i />
              <i />
              <i />
            </span>
            Claude が記事を読んでいます… 指示文と記事は分けて渡し、存在しない手法 ID は破棄します
          </p>
        )}
        {showResult && (
          <div className="reading-result">
            <h2>{c.title}</h2>
            <p className="muted small">
              被害の型：{c.damageType === "ransomware" ? "業務停止（暗号化）" : c.damageType}　／
              段階の明確さ：
              {c.clarity === "clear" ? "明確" : c.clarity === "partial" ? "一部推定" : "入口不明"}
            </p>
            <ol className="reading-steps">
              {rows.map((s, i) => {
                const show = elapsed >= T_RESULT + 0.5 + i * 0.55;
                return (
                  <li
                    key={`${s.tactic}-${s.techniques.join(",")}-${s.source}`}
                    className={show ? "show" : ""}
                  >
                    <span
                      className={`st ${s.source === "stated" ? "green" : s.source === "inferred" ? "amber" : "red"}`}
                    >
                      {SOURCE_JA[s.source]}
                    </span>
                    <span className="reading-tactic">{labels?.tactics[s.tactic] ?? s.tactic}</span>
                    <span className="reading-tech mono">
                      {s.techniques.map((t) => (
                        <b key={t} title={labels?.techniques[t] ?? ""}>
                          {t}
                        </b>
                      ))}
                    </span>
                    <span className="reading-tname">
                      {labels?.techniques[s.techniques[0] ?? ""] ?? ""}
                    </span>
                    {s.quote && <q className="reading-quote">{s.quote.replace(/\s+/g, "")}</q>}
                  </li>
                );
              })}
            </ol>
            <p className="muted small">
              手法 ID は MITRE ATT&amp;CK Enterprise v{app.knowledge?.attackVersion ?? ""}
              。記事は信頼できないデータとして扱い、 型紙にない手法と存在しない ID は破棄しました。
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
