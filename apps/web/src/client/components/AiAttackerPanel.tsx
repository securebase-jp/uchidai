/**
 * AI が見つけた経路の枠。下見の過程をターミナル風に流し、検証済みの経路と破棄の理由、
 * 対策の後も開いている入口を示す。経路図への描画は useStage に渡す verdict.paths（source: ai）が担う
 */
import { useEffect, useState } from "react";
import { useAiAttacker } from "../hooks/useAiAttacker.tsx";
import { useApp } from "../hooks/useApp.tsx";
import { STATE_LABEL, STATE_TONE } from "../lib/labels.ts";
import type { AttackPath, Graph, LabelsFile, MeasureDef, Verdict } from "../lib/types.ts";
import "./ai-attacker.css";

function toneOf(line: string): string {
  if (line.includes("→ 採用")) return "green";
  if (line.includes("破棄")) return "red";
  if (line.startsWith("結果") || line.startsWith("検証し直し")) return "violet";
  return "ink";
}

/** 行を 1 本ずつ順に出す（動きを減らす設定では一度に出す） */
function useRevealed(lines: string[], reduced: boolean): number {
  const [n, setN] = useState(reduced ? lines.length : 0);
  useEffect(() => {
    if (reduced) {
      setN(lines.length);
      return;
    }
    setN((cur) => Math.min(cur, lines.length));
    const id = setInterval(() => {
      setN((cur) => {
        if (cur >= lines.length) {
          clearInterval(id);
          return cur;
        }
        return cur + 1;
      });
    }, 420);
    return () => clearInterval(id);
  }, [lines, reduced]);
  return n;
}

export type AiSummary = {
  tone: "red" | "green" | "amber";
  textJa: string;
  /** 開いている入口を止める対策ボタン */
  suggested: MeasureDef[];
};

/** 判定の文：対策の後も開いている入口があるか（確実に通る入口、未確認の段階を含む入口、止まった入口に分ける） */
export function aiSummary(
  paths: AttackPath[],
  graph: Graph,
  appliedMeasures: MeasureDef[],
  measures: MeasureDef[],
): AiSummary | undefined {
  if (paths.length === 0) return undefined;
  const label = (id: string) => graph.nodes.find((n) => n.id === id)?.label ?? id;
  const entryLabel = (p: AttackPath) => label(p.steps[0]?.nodeId ?? "");
  const uniq = (xs: string[]) => [...new Set(xs)];
  const unsure = (p: AttackPath) =>
    p.steps.some((s) => s.state === "unknown" || s.state === "human");
  const open = paths.filter((p) => p.reachedCore);
  const certain = uniq(open.filter((p) => !unsure(p)).map(entryLabel));
  const pending = uniq(open.filter(unsure).map(entryLabel)).filter((l) => !certain.includes(l));
  const stopped = uniq(
    paths
      .filter((p) => !p.reachedCore)
      .map((p) => {
        const b = p.steps.find((s) => s.state === "blocked");
        return b ? label(b.nodeId) : entryLabel(p);
      }),
  );
  const applied = appliedMeasures.map((m) => m.labelJa).join("・");
  const suggested = measures.filter((m) =>
    open.some((p) => {
      const e = p.steps[0];
      return (
        e &&
        m.patches.some((x) => x.role === e.role && e.mitigations.includes(x.mitigation)) &&
        !appliedMeasures.some((a) => a.id === m.id)
      );
    }),
  );
  const parts: string[] = [];
  if (certain.length > 0)
    parts.push(
      applied
        ? `${applied}を適用しても、まだ「${certain.join("」「")}」の入口が開いています`
        : `AI が見つけた経路：「${certain.join("」「")}」から中核に到達します`,
    );
  if (stopped.length > 0)
    parts.push(
      certain.length > 0
        ? `「${stopped.join("」「")}」の経路は止まります`
        : `AI が見つけた経路は「${stopped.join("」「")}」で止まります`,
    );
  if (pending.length > 0)
    parts.push(`「${pending.join("」「")}」からの経路は未確認の段階を含みます（確認依頼で確定）`);
  return {
    tone: certain.length > 0 ? "red" : pending.length > 0 ? "amber" : "green",
    textJa: parts.join("。"),
    suggested,
  };
}

export function AiAttackerPanel({
  graph,
  verdict,
  labels,
  measures,
  reduced,
}: {
  graph: Graph;
  verdict: Verdict;
  labels: LabelsFile;
  measures: MeasureDef[];
  reduced: boolean;
}) {
  const app = useApp();
  const ai = useAiAttacker();
  const shown = useRevealed(ai.log, reduced);
  const applied = measures.filter((m) => app.measureIds.includes(m.id));
  const summary = aiSummary(ai.paths, graph, applied, measures);
  const label = (id: string) => graph.nodes.find((n) => n.id === id)?.label ?? id;
  const tech = (id: string | undefined) =>
    id ? `${id} ${labels.techniques[id] ?? ""}`.trim() : "";
  const articleStopped = verdict.result === "blocked" || verdict.result === "mitigated";

  return (
    <div className="panel ai-panel" aria-live="polite">
      <h2>AI攻撃者が見つけた経路（型紙にない入口）</h2>
      <p className="muted small">
        Claude に渡すのは、役割の枠に抽象化したカルテ（製品名・社名・ホスト名なし）と ATT&amp;CK
        の手法一覧だけ。返ってきた候補は、プログラムが手法 ID・役割・つながり・判定ルールの 4
        点で検証してから表示します。手順・コマンド・製品名は出力させません。
      </p>
      <div className="row" style={{ marginTop: 8 }}>
        <button
          type="button"
          className="btn primary"
          onClick={() => void ai.run()}
          disabled={ai.busy || app.busy}
        >
          {ai.busy ? "下見しています…" : ai.ran ? "もう一度下見させる" : "AI攻撃者に下見させる"}
        </button>
        {ai.recorded === true && (
          <span className="chip">
            記録の再生（実際の出力の記録
            {ai.meta?.recordedAt ? `、${ai.meta.recordedAt.slice(0, 10)}` : ""}
            {ai.meta?.attempts ? `、${ai.meta.attempts} 回目で発見` : ""}）
          </span>
        )}
        {ai.recorded === false && ai.meta?.model && (
          <span className="chip">いま実行（{ai.meta.model}）</span>
        )}
      </div>
      {ai.error && (
        <p className="err small" style={{ marginTop: 6 }}>
          {ai.error}
        </p>
      )}
      {ai.log.length > 0 && (
        <section className="term ai-term" aria-label="AI攻撃者の下見（過程）">
          {ai.log.slice(0, shown).map((l) => (
            <p key={l} className={`ln tone-${toneOf(l)}`}>
              <span className="pr">&gt; </span>
              {l}
            </p>
          ))}
          {shown < ai.log.length && (
            <div>
              <span className="cur" aria-hidden="true" />
            </div>
          )}
        </section>
      )}
      {summary && shown >= ai.log.length && (
        <div className={`ai-verdict tone-${summary.tone}`}>
          {summary.textJa}
          {summary.tone !== "green" &&
            articleStopped &&
            "。記事の経路は止まっても、こちらは別の入口です"}
        </div>
      )}
      {summary && summary.suggested.length > 0 && shown >= ai.log.length && (
        <div className="row" style={{ marginTop: 8 }}>
          <span className="muted small">この入口を止める対策：</span>
          {summary.suggested.map((m) => (
            <button
              type="button"
              key={m.id}
              className="btn sm"
              onClick={() => app.toggleMeasure(m.id)}
              disabled={app.busy}
            >
              {m.labelJa}
            </button>
          ))}
        </div>
      )}
      {ai.paths.length > 0 && shown >= ai.log.length && (
        <ul className="ai-paths">
          {ai.paths.map((p) => (
            <li key={p.id}>
              <div className="chain">
                <span className="chip mono">{p.id}</span>
                {p.steps.map((s, i) => (
                  <span key={`${s.nodeId}-${s.technique ?? i}`} className="chain">
                    {i > 0 && <span className="arrow">→</span>}
                    <span>
                      {label(s.nodeId)} <code>{tech(s.technique)}</code>
                    </span>
                    <span className={`st ${STATE_TONE[s.state]}`}>{STATE_LABEL[s.state]}</span>
                  </span>
                ))}
              </div>
              <p className="why">
                {p.steps.map((s) => `${label(s.nodeId)}：${s.reasonJa}`).join("　")}
              </p>
            </li>
          ))}
        </ul>
      )}
      {ai.discarded.length > 0 && shown >= ai.log.length && (
        <details className="ai-discarded">
          <summary>破棄した候補 {ai.discarded.length} 本（理由）</summary>
          <ul>
            {ai.discarded.map((d) => (
              <li key={`${d.titleJa ?? ""}-${d.steps.map((s) => s.role).join(">")}`}>
                「{d.titleJa ?? "無題"}」
                {d.steps.map((s) => `${s.role} ${s.technique}`).join(" → ")}：{d.reasons.join("；")}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
