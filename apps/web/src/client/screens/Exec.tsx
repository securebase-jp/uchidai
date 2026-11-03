/** 社長画面：30〜40 秒で自動再生する一本の物語。専門用語や ID を出さない */
import { useMemo, useRef } from "react";
import { CompanyChoiceList } from "../components/CompanyPicker.tsx";
import { Diagram } from "../components/Diagram.tsx";
import { InfoButton } from "../components/InfoButton.tsx";
import { MeasurePanel } from "../components/MeasurePanel.tsx";
import { Meters } from "../components/Meters.tsx";
import { Particles } from "../components/Particles.tsx";
import { VerdictBanner } from "../components/VerdictBanner.tsx";
import { useDemoBridge } from "../demo/bridge.ts";
import { isDemoMode } from "../demo/params.ts";
import { useAiAttacker, withAiPaths } from "../hooks/useAiAttacker.tsx";
import { useApp } from "../hooks/useApp.tsx";
import { useFitScale } from "../hooks/useFitScale.ts";
import type { Settings } from "../hooks/useSettings.ts";
import { type StageInput, useStage } from "../hooks/useStage.ts";
import { RESULT_TONE } from "../lib/labels.ts";
import { Legend } from "./Staff.tsx";

export function Exec({ settings }: { settings: Settings }) {
  const app = useApp();
  const { knowledge, profile, theCase, measureIds, evaluation, busy } = app;
  const aiPaths = useAiAttacker().paths;
  const input = useMemo<StageInput | undefined>(
    () =>
      evaluation && knowledge
        ? {
            graph: evaluation.graph,
            verdict: withAiPaths(evaluation.verdict, aiPaths),
            profile: evaluation.profile,
            applied: evaluation.measures,
            labels: knowledge.labels,
          }
        : undefined,
    [evaluation, knowledge, aiPaths],
  );
  // 一本の物語として 30〜40 秒：侵入の区間を半分の速さで
  const stage = useStage(input, { reduced: settings.reduced, autoplay: true, speed: 0.5 });
  useDemoBridge(stage?.clock); // デモモード（S8）が結論まで進める・速さを操作する
  // 舞台を画面の幅と高さに合わせて縮める。デモモード（録画は 1920×1080）では台本の座標を変えないよう等倍に固定
  const fitOuter = useRef<HTMLDivElement>(null);
  const fitInner = useRef<HTMLDivElement>(null);
  const fit = useFitScale(fitOuter, fitInner, undefined, !isDemoMode(), stage !== undefined);

  if (!profile) {
    return (
      <div className="panel" style={{ marginTop: 16 }}>
        <CompanyChoiceList />
      </div>
    );
  }
  if (!stage || !knowledge || !theCase) {
    return (
      <div className="panel" style={{ marginTop: 16 }}>
        <h2>準備中</h2>
        <p className="muted">会社カルテと事例を選ぶと、ここに物語が流れます。</p>
        <p className="row" style={{ marginTop: 8 }}>
          <a className="btn primary" href="#/">
            はじめにへ
          </a>
        </p>
      </div>
    );
  }
  const { layout, scene, script, clock } = stage;
  const plainMeasures = knowledge.measures;
  // 赤の結論に達した瞬間だけの警告（帯の点滅、数字の赤、構成図のひと呼吸の赤）
  const alarm =
    scene.concluded &&
    !stage.swapping &&
    !busy &&
    RESULT_TONE[stage.input.verdict.result] === "red";
  return (
    <div className="exec">
      <div className="exec-tools">
        <InfoButton title="この画面の見方">
          <p>
            報道と同じ攻撃が、{profile.companyName}
            {profile.fictional ? "（架空の会社）" : ""}
            に来たらどうなるかを、一本の物語として自動で再生します。結論が出ると、帯の色と計器の数字が変わります。
          </p>
          <p>
            会社と数値は
            {profile.fictional ? "すべて架空です。" : "会社カルテの登録内容にもとづく目安です。"}
            攻撃の流れは公開された事例（{theCase.title}）をもとにしています。
          </p>
        </InfoButton>
      </div>
      <div className="exec-fit" ref={fitOuter} style={{ height: fit.height }}>
        <div
          className="exec-stage"
          ref={fitInner}
          style={{ transform: fit.scale === 1 ? undefined : `scale(${fit.scale})` }}
        >
          <div className="exec-top">
            <VerdictBanner
              verdict={stage.input.verdict}
              scene={scene}
              script={script}
              graph={stage.input.graph}
              fired={clock.fired}
              plain
              big
              swapping={stage.swapping || busy}
              alert
            />
            <div className="numbers">
              <Meters
                clock={clock}
                scene={scene}
                verdict={stage.input.verdict}
                profile={stage.input.profile}
                alert
              />
            </div>
          </div>
          <div className="stage">
            <Diagram
              layout={layout}
              graph={stage.input.graph}
              scene={scene}
              script={script}
              profile={stage.input.profile}
              showIds={false}
              measureLabel={(m) =>
                knowledge.labels.mitigations[m] ?? knowledge.labels.custom[m]?.labelJa ?? ""
              }
            />
            <Particles
              layout={layout}
              scene={scene}
              script={script}
              clock={clock}
              reduced={settings.reduced}
            />
            <Legend />
            {alarm && <div className="stage-flash" aria-hidden="true" />}
            <div className="controls overlay">
              <button
                type="button"
                className="btn primary sm"
                onClick={clock.ended ? clock.restart : clock.toggle}
                disabled={settings.reduced}
              >
                {clock.ended ? "もう一度見る" : clock.playing ? "一時停止" : "続きを見る"}
              </button>
              <button type="button" className="btn sm" onClick={clock.toEnd} disabled={clock.ended}>
                結論まで進める
              </button>
              <label className="group lab" style={{ cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={settings.reduced}
                  onChange={(e) => settings.setReduced(e.target.checked)}
                />
                動きを減らす
              </label>
            </div>
          </div>
          {scene.concluded && aiPaths.some((p) => p.reachedCore) && (
            <p className="err" style={{ textAlign: "center" }}>
              {measureIds.length > 0 ? "いまの対策をしても、" : ""}
              報道にない別の入口（
              {[
                ...new Set(
                  aiPaths
                    .filter((p) => p.reachedCore)
                    .map(
                      (p) =>
                        stage.input.graph.nodes.find((n) => n.id === p.steps[0]?.nodeId)?.label,
                    ),
                ),
              ].join("、")}
              ）がまだ開いています
            </p>
          )}
          {scene.concluded && (
            <MeasurePanel
              measures={plainMeasures}
              selected={measureIds}
              verdict={evaluation?.verdict}
              costs={evaluation?.measureCosts}
              onToggle={app.toggleMeasure}
              onClear={app.clearMeasures}
              plain
              disabled={busy}
            />
          )}
        </div>
      </div>
    </div>
  );
}
