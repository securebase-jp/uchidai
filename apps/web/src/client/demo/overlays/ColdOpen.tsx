/**
 * 冒頭の 4 秒（コールドオープン。場面 1 の最初の 4 秒、読み上げは無く効果音だけ）：
 * 暗転 → 赤い線が構成図を一瞬で走る → 「業務停止 10 日／売上影響 約 1 億円」→ 無音の暗転 0.5 秒 → チャットへ。
 * 図と数字は、デモ精工 × 事例 1 の判定結果（app.evaluation）をそのまま描く。文字を直書きしない。
 */
import { useMemo } from "react";
import "../../components/flow.css";
import { Diagram } from "../../components/Diagram.tsx";
import { useApp } from "../../hooks/useApp.tsx";
import { yen } from "../../lib/labels.ts";
import { layoutGraph } from "../../lib/layout.ts";
import { buildScript, firedCount, sceneAt } from "../../lib/playback.ts";

/** 時刻（overlay が出てからの秒）。効果音（demo/sfx.json の場面 1）と合わせてある */
export const COLD_OPEN = {
  /** 図が浮かび、赤い線が走り始める */
  lineFrom: 0.3,
  /** 赤い線が走り終える */
  lineTo: 1.5,
  /** 数字が出る（強い一打） */
  figures: 1.7,
  /** 暗転して無音になる */
  fadeOut: 3.5,
} as const;

export function ColdOpenOverlay({ elapsed }: { elapsed: number }) {
  const app = useApp();
  const ev = app.evaluation;
  const profile = app.profile;
  const graph = ev?.graph;
  const layout = useMemo(() => (graph ? layoutGraph(graph) : undefined), [graph]);
  const script = useMemo(
    () => (ev && profile ? buildScript(ev.graph, ev.verdict, profile, { applied: [] }) : undefined),
    [ev, profile],
  );
  // 再生の台本のうち、人の手順で決まる経路（AI の経路を除く）の線が届くまでを、lineFrom〜lineTo に縮めて流す
  const end = useMemo(() => {
    if (!script) return 0;
    let t = 0;
    for (const b of script.beats) {
      if (b.kind === "traverse" && b.source !== "ai") t = Math.max(t, b.t + b.dur);
      if (b.kind === "arrive" && b.source !== "ai") t = Math.max(t, b.t);
    }
    return t;
  }, [script]);
  if (!ev || !graph || !layout || !script || !profile)
    return <div className="demo-overlay cold-open" />;

  const k = Math.min(
    1,
    Math.max(0, (elapsed - COLD_OPEN.lineFrom) / (COLD_OPEN.lineTo - COLD_OPEN.lineFrom)),
  );
  const fired = elapsed < COLD_OPEN.lineFrom ? 0 : firedCount(script.beats, k * end);
  const scene = sceneAt(script, graph, fired);
  const impact = ev.verdict.impact;
  const showFigures = elapsed >= COLD_OPEN.figures;
  const dark = elapsed >= COLD_OPEN.fadeOut;

  return (
    <div className={`demo-overlay cold-open${dark ? " dark" : ""}`} aria-hidden="true">
      <div
        className={`co-stage${elapsed >= COLD_OPEN.lineFrom ? " in" : ""}${showFigures ? " sink" : ""}`}
      >
        <Diagram layout={layout} graph={graph} scene={scene} script={script} profile={profile} />
      </div>
      {showFigures && (
        <dl className="co-figures">
          {impact.downtimeDays > 0 && (
            <div>
              <dt>業務停止</dt>
              <dd>{impact.downtimeDays} 日</dd>
            </div>
          )}
          {(impact.revenueImpactJpy ?? 0) > 0 && (
            <div>
              <dt>売上影響</dt>
              <dd>{yen(impact.revenueImpactJpy).replace(/^約/, "約 ")}</dd>
            </div>
          )}
        </dl>
      )}
    </div>
  );
}
