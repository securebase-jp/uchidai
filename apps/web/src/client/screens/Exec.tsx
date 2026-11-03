/** 社長画面：30〜40 秒で自動再生する一本の物語。専門用語や ID を出さない */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import { stepZoom } from "../lib/fit.ts";
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
  // 手動の倍率（0.5〜1.5、0.1 刻み）。undefined なら自動。保存しない
  const [zoom, setZoom] = useState<number | undefined>(undefined);
  // 発表モード（全画面）：上部バーを隠し、舞台だけを画面に合わせる。Esc か「戻る」で解除。
  // 全画面が許可されない場面（埋め込みなど）でも、上部バーを隠す発表の状態だけは成り立つようにする
  const canPresent =
    typeof document !== "undefined" && !!document.documentElement.requestFullscreen;
  const [presenting, setPresenting] = useState(false);
  useEffect(() => {
    if (!presenting) return;
    // 全画面を Esc で抜けたら発表も終える。全画面でないときの Esc も同じ
    const onChange = () => {
      if (document.fullscreenElement === null) setPresenting(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && document.fullscreenElement === null) setPresenting(false);
    };
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("keydown", onKey);
    };
  }, [presenting]);
  useLayoutEffect(() => {
    if (presenting) document.documentElement.setAttribute("data-presenting", "true");
    else document.documentElement.removeAttribute("data-presenting");
    return () => document.documentElement.removeAttribute("data-presenting");
  }, [presenting]);
  const present = useCallback(() => {
    setZoom(undefined);
    setPresenting(true);
    document.documentElement.requestFullscreen?.().catch(() => {});
  }, []);
  const leave = useCallback(() => {
    setPresenting(false);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }, []);
  const fit = useFitScale(fitOuter, fitInner, zoom, !isDemoMode(), stage !== undefined, presenting);

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
        <fieldset className="group exec-zoom" aria-label="拡大縮小">
          <button
            type="button"
            className="btn sm"
            aria-label="縮小"
            onClick={() => setZoom((z) => stepZoom(z ?? fit.auto, -1))}
          >
            −
          </button>
          <button
            type="button"
            className="btn sm"
            aria-pressed={zoom === undefined}
            onClick={() => setZoom(undefined)}
          >
            画面に合わせる
          </button>
          <button
            type="button"
            className="btn sm"
            aria-label="拡大"
            onClick={() => setZoom((z) => stepZoom(z ?? fit.auto, 1))}
          >
            ＋
          </button>
          <span className="lab" aria-live="polite">
            {Math.round(fit.scale * 100)}%
          </span>
        </fieldset>
        {canPresent &&
          (presenting ? (
            <button type="button" className="btn sm exec-present" onClick={leave}>
              戻る
            </button>
          ) : (
            <button type="button" className="btn sm exec-present" onClick={present}>
              社長に見せる（全画面）
            </button>
          ))}
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
          <p>
            画面全体は、ブラウザの大きさに合わせて自動で縮めています。「−」「＋」で倍率を 0.5〜1.5
            倍の範囲で変えられ、「画面に合わせる」で自動に戻ります。
          </p>
        </InfoButton>
      </div>
      <div className="exec-fit" ref={fitOuter} style={{ height: fit.height }}>
        <div
          className="exec-stage"
          ref={fitInner}
          style={{ transform: fit.scale === 1 ? undefined : `scale(${fit.scale})` }}
        >
          {/* 左の列：結論の帯と構成図。右の列：計器と、結論後の対策（倍率の計算に含めない） */}
          <div className="exec-main">
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
                <button
                  type="button"
                  className="btn sm"
                  onClick={clock.toEnd}
                  disabled={clock.ended}
                >
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
          </div>
          <div className="exec-side">
            <div className="exec-side-in">
              <div className="numbers">
                <Meters
                  clock={clock}
                  scene={scene}
                  verdict={stage.input.verdict}
                  profile={stage.input.profile}
                  alert
                />
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
      </div>
    </div>
  );
}
