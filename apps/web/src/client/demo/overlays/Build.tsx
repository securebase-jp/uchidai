/**
 * 最初の5問で、構成図のノードが順に現れる（場面 4 の後半）。
 * 5問の画面（screens/Questions.tsx）と同じ部品と見た目で、質問の文言は knowledge の質問表から、
 * 構成図はデモ用カルテの判定に使う構成グラフから読む。API は呼ばず、カルテも書き換えない（毎回同じ映像になる）。
 */
import { useMemo } from "react";
import "../../components/flow.css";
import { Diagram } from "../../components/Diagram.tsx";
import { useApp } from "../../hooks/useApp.tsx";
import { layoutGraph } from "../../lib/layout.ts";
import { optionsForIndustry } from "../../lib/question-options.ts";

/** 1 問あたりの秒数と、選んだ答え（デモ精工：製造業の工場、遠隔は VPN と保守ベンダー、バックアップはクラウド同期） */
const STEP = 1.0;
const PICK_AT = 0.35;
const ANSWERS: Record<string, string | string[] | Record<string, string>> = {
  industry: "manufacturing",
  site: "factory",
  hosting: { mail: "cloud", files: "onprem", core: "onprem", web: "provider" },
  remoteAccess: ["vpn", "vendor_remote"],
  backup: "cloud_sync",
};

export function BuildOverlay({ elapsed }: { elapsed: number }) {
  const app = useApp();
  const questions = app.knowledge?.questions ?? [];
  const graph = app.evaluation?.graph;
  const layout = useMemo(() => (graph ? layoutGraph(graph) : undefined), [graph]);
  if (!graph || !layout || questions.length === 0) return <div className="demo-overlay build" />;

  const step = Math.min(questions.length - 1, Math.floor(elapsed / STEP));
  const q = questions[step];
  const picked = elapsed - step * STEP >= PICK_AT;
  const answer = q ? ANSWERS[q.id] : undefined;

  // 質問の進みに合わせて、ノードを順に現す（最後の質問の少し後までに全部）
  const n = graph.nodes.length;
  const span = questions.length * STEP - 0.7;
  const at = (i: number) => 0.4 + (span * i) / Math.max(1, n);
  const hidden = new Set(graph.nodes.filter((_, i) => elapsed < at(i)).map((x) => x.id));
  const appearing = new Set(
    graph.nodes.filter((_, i) => elapsed >= at(i) && elapsed < at(i) + 0.6).map((x) => x.id),
  );
  const industry = typeof ANSWERS.industry === "string" ? ANSWERS.industry : undefined;

  return (
    <div className="demo-overlay build" role="dialog" aria-label="最初の5問で構成図が組み上がる">
      <div className="quiz build-quiz">
        <div className="qcard">
          <div className="progress" aria-hidden="true">
            {questions.map((x, i) => (
              <i key={x.id} className={i <= step ? "bar on" : "bar"} />
            ))}
          </div>
          {q && (
            <>
              <div className="step">
                {step + 1} / {questions.length}
              </div>
              <h2>{q.textJa}</h2>
              {q.id === "hosting" ? (
                q.rows.map((r) => {
                  const v = (answer as Record<string, string>)[r.key];
                  return (
                    <div className="hosting-row" key={r.key}>
                      <span className="k">{r.labelJa}</span>
                      <div className="opts-inline">
                        {q.options.map((o) => (
                          <button
                            type="button"
                            key={o.value}
                            className="btn sm"
                            tabIndex={-1}
                            aria-pressed={picked && v === o.value}
                          >
                            {o.labelJa}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="opts">
                  {optionsForIndustry(q.options, industry).map((o) => {
                    const on = Array.isArray(answer)
                      ? answer.includes(o.value)
                      : answer === o.value;
                    return (
                      <button
                        type="button"
                        key={o.value}
                        className="opt-btn"
                        tabIndex={-1}
                        aria-pressed={picked && on}
                      >
                        <span className="opt-label">{o.labelJa}</span>
                        <span className="muted">{picked && on ? "✓" : "›"}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
        <div className="stage">
          <Diagram layout={layout} graph={graph} hidden={hidden} appearing={appearing} />
        </div>
      </div>
    </div>
  );
}
