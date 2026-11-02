/** 担当者画面（操作型）：経路図と動き、計器、時間軸、対策ボタン、根拠の一覧、攻撃者ログ */
import { useMemo } from "react";
import { AiAttackerPanel } from "../components/AiAttackerPanel.tsx";
import { AttackerLog } from "../components/AttackerLog.tsx";
import { ComparisonPanel } from "../components/ComparisonPanel.tsx";
import { Controls } from "../components/Controls.tsx";
import { Diagram } from "../components/Diagram.tsx";
import { EvidencePanel } from "../components/EvidencePanel.tsx";
import { MeasurePanel } from "../components/MeasurePanel.tsx";
import { Meters, useDayCounter } from "../components/Meters.tsx";
import { Particles } from "../components/Particles.tsx";
import { RequestPanel } from "../components/RequestPanel.tsx";
import { TimelineBar } from "../components/TimelineBar.tsx";
import { VerdictBanner } from "../components/VerdictBanner.tsx";
import { useDemoBridge } from "../demo/bridge.ts";
import { useAiAttacker, withAiPaths } from "../hooks/useAiAttacker.tsx";
import { useApp } from "../hooks/useApp.tsx";
import type { Settings } from "../hooks/useSettings.ts";
import { type StageInput, useStage } from "../hooks/useStage.ts";
import { pendingCount } from "../lib/profile.ts";
import { timelineOf } from "../lib/timeline.ts";

export function Legend() {
  return (
    <div className="legend" aria-hidden="true">
      <span>
        <i /> 記事に記載
      </span>
      <span>
        <i className="dash" /> 推定・入口候補
      </span>
      <span>
        <i className="dot" /> AIが見つけた経路
      </span>
      <span>
        <b style={{ background: "var(--red)" }} /> 突破
      </span>
      <span>
        <b style={{ background: "var(--amber)" }} /> 未確認・人次第・法律上の義務
      </span>
      <span>
        <b style={{ background: "var(--green)" }} /> 止まる・復旧できる
      </span>
      <span>
        <b style={{ background: "var(--cyan)" }} /> 平時の通信
      </span>
      <span>
        <b style={{ background: "var(--cash)" }} /> お金の流れ
      </span>
    </div>
  );
}

export function Staff({ settings }: { settings: Settings }) {
  const app = useApp();
  const { knowledge, profile, theCase, caseMeta, measureIds, evaluation, busy, error } = app;
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
  const stage = useStage(input, { reduced: settings.reduced, autoplay: true });
  useDemoBridge(stage?.clock); // デモモード（S8）が結論まで進める・速さを操作する
  const day = useDayCounter(stage?.clock ?? dummyClock, stage?.scene ?? dummyScene);
  const tl = useMemo(
    () => (stage ? timelineOf(stage.input.verdict, stage.input.profile) : undefined),
    [stage],
  );

  if (!profile) {
    return (
      <div className="panel" style={{ marginTop: 16 }}>
        <h2>会社カルテがありません</h2>
        <p className="row" style={{ marginTop: 8 }}>
          <a className="btn primary" href="#/questions">
            最初の5問に答える
          </a>
          <button type="button" className="btn" onClick={() => void app.loadExample("demo-seiko")}>
            架空の会社（デモ精工）で試す
          </button>
        </p>
      </div>
    );
  }
  if (!stage || !knowledge || !theCase || !tl) {
    return (
      <p className="muted" style={{ marginTop: 16 }}>
        {error ? <span className="err">{error}</span> : "判定しています…"}
      </p>
    );
  }
  const { layout, scene, script, clock } = stage;
  const measureLabel = (m: string) =>
    knowledge.labels.mitigations[m] ?? knowledge.labels.custom[m]?.labelJa ?? m;

  // 5問から作った（または詳細が未登録の）自社のカルテ：未確認の件数とカルテ画面への案内（P1）
  const pending = profile.fictional ? 0 : pendingCount(profile);

  return (
    <div>
      {pending > 0 && (
        <div className="panel warn" style={{ marginBottom: 10 }}>
          <p className="small">
            <b>未確認の項目が {pending} 件あります。</b>
            未確認は「止まる」とは扱わないので、いまの結論は最悪の想定（または「確認中」）です。詳細を登録するか、ベンダーに確認すると判定が確定します。
            <a className="btn sm" href="#/profile" style={{ marginLeft: 10 }}>
              カルテに詳細を登録する
            </a>
          </p>
        </div>
      )}
      {theCase.clarity === "unknown" && (
        <div className="panel warn" style={{ marginBottom: 10 }}>
          <p className="small">
            <b>記事に入口が書かれていません。</b>
            型紙の入口候補（VPN
            装置、リモートデスクトップ、メールなど）だけで判定しています。別の入口から来る攻撃は判定に含まれないので、結論が「止められます」でも、この型紙の入口候補について止められる、という意味に留めてください。
          </p>
        </div>
      )}
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <p className="muted">{caseMeta?.sourceJa}</p>
          <h1 style={{ fontSize: 20 }}>{theCase.title}</h1>
        </div>
        <Meters
          clock={clock}
          scene={scene}
          verdict={stage.input.verdict}
          profile={stage.input.profile}
        />
      </div>
      <div style={{ marginTop: 10 }}>
        <VerdictBanner
          verdict={stage.input.verdict}
          scene={scene}
          script={script}
          graph={stage.input.graph}
          fired={clock.fired}
          caseTitle={theCase.title}
          swapping={stage.swapping || busy}
        />
      </div>
      {error && (
        <p className="err small" style={{ marginTop: 6 }}>
          {error}
        </p>
      )}
      <div className="layout-main">
        <div>
          <div className="stage">
            <Diagram
              layout={layout}
              graph={stage.input.graph}
              scene={scene}
              script={script}
              profile={stage.input.profile}
              showIds
              measureLabel={measureLabel}
            />
            <Particles
              layout={layout}
              scene={scene}
              script={script}
              clock={clock}
              reduced={settings.reduced}
            />
            <Legend />
          </div>
          <Controls clock={clock} reduced={settings.reduced} onReduced={settings.setReduced} />
          <TimelineBar
            view={tl}
            verdict={stage.input.verdict}
            profile={stage.input.profile}
            day={day}
            concluded={scene.concluded}
            reduced={settings.reduced}
          />
          <div style={{ marginTop: 12 }}>
            <MeasurePanel
              measures={knowledge.measures}
              selected={measureIds}
              verdict={evaluation?.verdict}
              costs={evaluation?.measureCosts}
              onToggle={app.toggleMeasure}
              onClear={app.clearMeasures}
              disabled={busy}
            />
          </div>
          <div style={{ marginTop: 12 }}>
            <AiAttackerPanel
              graph={stage.input.graph}
              verdict={evaluation?.verdict ?? stage.input.verdict}
              labels={knowledge.labels}
              measures={knowledge.measures}
              reduced={settings.reduced}
            />
          </div>
          <div style={{ marginTop: 12 }}>
            <ComparisonPanel />
          </div>
          <div style={{ marginTop: 12 }}>
            <EvidencePanel
              verdict={stage.input.verdict}
              theCase={theCase}
              profile={stage.input.profile}
              labels={knowledge.labels}
              graph={stage.input.graph}
            />
          </div>
          <div style={{ marginTop: 12 }}>
            <RequestPanel />
          </div>
        </div>
        <AttackerLog
          scene={scene}
          reduced={settings.reduced}
          attackVersion={stage.input.verdict.attackVersion}
        />
      </div>
    </div>
  );
}

const dummyClock = {
  timeRef: { current: 0 },
  fired: 0,
  playing: false,
  speed: 1,
  ended: false,
  rewinding: false,
  play() {},
  pause() {},
  toggle() {},
  restart() {},
  toEnd() {},
  setSpeed() {},
  rewindThen(cb: () => void) {
    cb();
  },
  subscribe() {
    return () => {};
  },
};
const dummyScene = {
  nodes: {},
  edges: {},
  flashes: [],
  concluded: false,
  walls: [],
  logs: [],
  daysTo: 0,
};
