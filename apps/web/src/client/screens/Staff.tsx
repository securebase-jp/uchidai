/** 担当者画面（操作型）：結論カード、経路図と動き、計器、時間軸、対策ボタン、根拠の一覧、攻撃者ログ */
import { useEffect, useMemo } from "react";
import { flushSync } from "react-dom";
import { AiAttackerPanel } from "../components/AiAttackerPanel.tsx";
import { AttackerLog } from "../components/AttackerLog.tsx";
import { Collapsible, REVEAL_EVENT } from "../components/Collapsible.tsx";
import { MissingChoices } from "../components/CompanyPicker.tsx";
import { ComparisonPanel } from "../components/ComparisonPanel.tsx";
import { Controls } from "../components/Controls.tsx";
import { Diagram } from "../components/Diagram.tsx";
import { EvidencePanel } from "../components/EvidencePanel.tsx";
import { FetchFailuresPanel } from "../components/FetchFailuresPanel.tsx";
import { IndustrySwitch } from "../components/IndustrySwitch.tsx";
import { InfoButton } from "../components/InfoButton.tsx";
import { MeasurePanel } from "../components/MeasurePanel.tsx";
import { Meters, useDayCounter } from "../components/Meters.tsx";
import { Particles } from "../components/Particles.tsx";
import { RequestPanel } from "../components/RequestPanel.tsx";
import { SeriesPanel } from "../components/SeriesPanel.tsx";
import { StaffBar } from "../components/StaffBar.tsx";
import { TimelineBar } from "../components/TimelineBar.tsx";
import { summary, VerdictBanner } from "../components/VerdictBanner.tsx";
import "../components/staff.css";
import { useDemoBridge } from "../demo/bridge.ts";
import { isDemoMode } from "../demo/params.ts";
import { useAiAttacker, withAiPaths } from "../hooks/useAiAttacker.tsx";
import { useApp } from "../hooks/useApp.tsx";
import { useRequests } from "../hooks/useRequests.tsx";
import type { Settings } from "../hooks/useSettings.ts";
import { type StageInput, useStage } from "../hooks/useStage.ts";
import { type NextMove, reasonSentence } from "../lib/conclusion.ts";
import { RESULT_SHORT } from "../lib/labels.ts";
import { focusOutbox, parseOutboxParam } from "../lib/outbox-focus.ts";
import { rankPending, templateHeading, unknownStepLabels } from "../lib/pending.ts";
import { readNotices } from "../lib/read-notices.ts";
import { requestsAutoOpen, staffCounts } from "../lib/staff-status.ts";
import { timelineOf } from "../lib/timeline.ts";

export function Legend() {
  return (
    <div className="legend" aria-hidden="true">
      <span>
        <i /> 記事に書いてある
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

/** 区画の id（結論カードと目次から移動する） */
export const STAFF_SECTION = {
  verdict: "staff-verdict",
  diagram: "staff-diagram",
  measures: "staff-measures",
  evidence: "staff-evidence",
  requests: "staff-requests",
  /** 確認依頼の中の送信箱（確認依頼の枠を開いてから移動する） */
  outbox: "staff-outbox",
  industry: "staff-industry",
  ai: "staff-ai",
  comparison: "staff-comparison",
  series: "staff-series",
} as const;

const TOC: [string, string][] = [
  [STAFF_SECTION.verdict, "結論"],
  [STAFF_SECTION.diagram, "経路図"],
  [STAFF_SECTION.measures, "対策"],
  [STAFF_SECTION.evidence, "根拠"],
  [STAFF_SECTION.requests, "確認依頼"],
];

/**
 * ページ内の区画へ移動する（ハッシュは画面の切り替えに使っているので、アンカーの href は使わない）。
 * 折りたたまれた区画は、先に開いてから移動する。動きを減らす設定のときは、すぐに移動する
 */
export function jumpTo(id: string): void {
  flushSync(() => {
    window.dispatchEvent(new CustomEvent(REVEAL_EVENT, { detail: id }));
  });
  const reduced = document.documentElement.dataset.reduced === "true";
  document
    .getElementById(id)
    ?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
}

export function Staff({ settings }: { settings: Settings }) {
  const app = useApp();
  const { knowledge, profile, theCase, caseMeta, measureIds, evaluation, busy, error } = app;
  const ai = useAiAttacker();
  const aiPaths = ai.paths;
  const reqs = useRequests();
  const demo = isDemoMode(); // デモモード（?demo=1）は、帯も折りたたみもなしで従来どおりに出す（動画の場面 5〜8）
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

  // 「依頼済み・回答待ち」の札から来たとき（#/staff?outbox=…）：判定が出て画面ができてから送信箱へ移動する。
  // 画面の切り替え直後のスクロール位置の戻し（Shell）より後に動かすため、少し待つ。見せたら印は消す
  const ready = Boolean(profile && theCase && stage && knowledge && tl);
  useEffect(() => {
    if (!ready) return;
    const key = parseOutboxParam(location.hash);
    if (key === undefined) return;
    const t = setTimeout(() => {
      // 確認依頼が折りたたまれていても、先に開いてから送信箱へ移動する（固定帯・折りたたみとの組み合わせ）
      flushSync(() => {
        window.dispatchEvent(new CustomEvent(REVEAL_EVENT, { detail: STAFF_SECTION.outbox }));
      });
      focusOutbox(key);
      history.replaceState(null, "", "#/staff");
    }, 80);
    return () => clearTimeout(t);
  }, [ready]);

  if (!profile || !theCase) return <MissingChoices />;
  if (!stage || !knowledge || !tl) {
    return (
      <p className="muted" style={{ marginTop: 16 }}>
        {error ? <span className="err">{error}</span> : "判定しています…"}
      </p>
    );
  }
  const { layout, scene, script, clock } = stage;
  const measureLabel = (m: string) =>
    knowledge.labels.mitigations[m] ?? knowledge.labels.custom[m]?.labelJa ?? m;

  // 5問から作った（または詳細が未登録の）自社のカルテ：未確認の件数とカルテ画面への案内（P1）。
  // 件数は判定に使ったカルテ（送信箱の回答を重ねたもの）で数える
  const current = evaluation?.profile ?? profile;
  const ranked = profile.fictional
    ? []
    : rankPending(current, evaluation?.verdict, evaluation?.graph);
  const pending = ranked.length;
  const counts = staffCounts(pending, reqs.items);
  const requestsOpen = requestsAutoOpen(counts);
  const onPath = ranked.filter((x) => x.onPath);
  const unknownSteps = evaluation ? unknownStepLabels(evaluation.verdict, evaluation.graph) : [];
  const result = evaluation?.verdict.result;
  // 読解の確認：攻撃の記事ではないと判断したとき、本文が途中で切れていそうなとき
  const notices = readNotices(theCase, caseMeta?.readFlags);
  const heading = evaluation
    ? templateHeading(evaluation.verdict, knowledge.templates).replace(/^型紙/, "攻撃の型（型紙）")
    : "";

  // 結論カードの材料：理由の一文と次の一手（いまの判定で。巻き戻し中は直前の判定）
  const verdictNow = evaluation?.verdict ?? stage.input.verdict;
  const graphNow = evaluation?.graph ?? stage.input.graph;
  const reason = reasonSentence(verdictNow, graphNow, knowledge.labels.techniques);
  const impactText = summary(stage.input.verdict, false);
  const moves: NextMove[] = (evaluation?.nextMoves ?? []).flatMap((n) => {
    const measure = knowledge.measures.find((m) => m.id === n.measureId);
    return measure ? [{ measure, ...(n.stageJa ? { stageJa: n.stageJa } : {}) }] : [];
  });

  return (
    <div className={`staff${demo ? "" : " has-bar"}`}>
      {!demo && (
        <StaffBar
          counts={counts}
          toc={TOC}
          requestsId={STAFF_SECTION.requests}
          outboxId={STAFF_SECTION.outbox}
          onJump={jumpTo}
        />
      )}
      <div id={STAFF_SECTION.verdict}>
        <VerdictBanner
          verdict={stage.input.verdict}
          scene={scene}
          script={script}
          graph={stage.input.graph}
          fired={clock.fired}
          caseTitle={theCase.title}
          swapping={stage.swapping || busy}
          conclusionFirst
          info={
            <InfoButton title="結論の読み方" align="end">
              {(reason || impactText) && (
                <p>
                  {reason && `${reason}。`}
                  {impactText && `${impactText}。`}
                </p>
              )}
              <p>
                結論は「止められます」「侵入は防げませんが被害は抑えられます」「大丈夫ではありませんでした」「確認中」の
                4
                種類です。報道と同じ攻撃が御社の構成に来たとき、どの段階で止まるかをプログラムが判定ルールで決めています。
              </p>
              {pending > 0 && (
                <p>
                  未確認の項目が {pending} 件あります。
                  {onPath.length > 0
                    ? `うち、この攻撃の経路で問われているのは ${onPath.length} 件（${[...new Set(onPath.map((x) => x.assetLabel))].join("、")}）です。`
                    : "この攻撃の経路で問われている項目はありません。"}
                  {result === "breached" &&
                    unknownSteps.length > 0 &&
                    `いまの結論「${RESULT_SHORT.breached}」は、未確認の段階（${unknownSteps.join("、")}）を「突破される」とみなした最悪の想定です。未確認は「止まる」とは扱いません。`}
                  {result === "pending" &&
                    `いまの結論は「${RESULT_SHORT.pending}」です。未確認の段階（${unknownSteps.join("、")}）が決まると結論が決まります。`}
                  {result !== "breached" &&
                    result !== "pending" &&
                    onPath.length === 0 &&
                    "この攻撃の結論は未確認の段階を通らずに出ています。残りの未確認は別の攻撃で問われることがあります。"}
                  {onPath.length > 0 &&
                    "経路の項目から答える（またはベンダーに確認する）と、結論が変わりやすくなります。"}
                  <a href="#/profile">
                    {onPath.length > 0
                      ? `カルテで経路の ${onPath.length} 件から答える`
                      : "カルテに詳細を登録する"}
                  </a>
                  こともできます。
                  {profile.companyName === "うちの会社" && "会社名もカルテで登録できます。"}
                </p>
              )}
              {theCase.clarity === "unknown" && (
                <p>
                  記事に入口が書かれていません。攻撃の型（型紙）の入口候補（VPN
                  装置、リモートデスクトップ、メールなど）だけで判定しています。別の入口から来る攻撃は判定に含まれないので、結論が「止められます」でも、この型紙の入口候補について止められる、という意味に留めてください。
                </p>
              )}
              <p>
                再生中は、いまどの段階まで進んだかをこの枠の中に小さく出します。再生が終わると結論だけに戻ります。
              </p>
            </InfoButton>
          }
        >
          {(moves.length > 0 || (pending > 0 && demo)) && (
            <div className="verdict-actions">
              {moves.length > 0 && <span className="lab">次の一手</span>}
              {moves.map((m) => (
                <button
                  type="button"
                  key={m.measure.id}
                  className="btn sm"
                  disabled={busy}
                  onClick={() => app.toggleMeasure(m.measure.id)}
                  title={m.stageJa ? `この段階に効く：${m.stageJa}` : undefined}
                >
                  {m.measure.labelJa}
                </button>
              ))}
              {pending > 0 && demo && (
                <button
                  type="button"
                  className="btn sm ghost pending"
                  onClick={() => jumpTo(STAFF_SECTION.requests)}
                >
                  未確認 {pending} 件
                </button>
              )}
            </div>
          )}
        </VerdictBanner>
      </div>
      {demo && (
        <nav className="staff-toc" aria-label="区画の目次">
          {TOC.map(([id, label]) => (
            <button type="button" key={id} className="toc-link" onClick={() => jumpTo(id)}>
              {label}
            </button>
          ))}
        </nav>
      )}
      {error && (
        <p className="err small" style={{ marginTop: 6 }}>
          {error}
        </p>
      )}
      <div
        className="row"
        style={{ justifyContent: "space-between", alignItems: "flex-start", marginTop: 12 }}
      >
        <div>
          <p className="muted">
            {caseMeta?.sourceJa}
            {heading && <> ／ {heading}</>}
          </p>
          <h1 style={{ fontSize: 20 }}>{theCase.title}</h1>
          {notices.map((n) => (
            <p key={n.id} className={`read-notice ${n.tone}`}>
              {n.textJa}
              {n.pasteLink && (
                <>
                  {"　"}
                  <a href="#/">はじめにの「本文」から貼る</a>
                </>
              )}
            </p>
          ))}
          <FetchFailuresPanel />
        </div>
        <Meters
          clock={clock}
          scene={scene}
          verdict={stage.input.verdict}
          profile={stage.input.profile}
        />
      </div>
      <div className="layout-main">
        <div>
          <section className="stage-wrap" id={STAFF_SECTION.diagram} aria-label="経路図">
            <Controls
              clock={clock}
              reduced={settings.reduced}
              onReduced={settings.setReduced}
              sticky
              extra={
                <InfoButton title="図の見方" align="end">
                  <p>
                    上の段がシステム（会社の IT
                    と人）、中の段が業務、下の段が経営（影響・お金・義務）です。
                    線は記事に書いてある経路を実線で、推定や入口候補を破線で、AI
                    が見つけた経路を点線で描きます。構成要素の色は、赤が突破、黄が未確認・人次第・法律上の義務、緑が止まる・復旧できるを表し、色だけでなく語でも示します。
                    水色の粒は平時の通信、緑の粒はお金の流れです。
                  </p>
                  <Legend />
                </InfoButton>
              }
            />
            <div className="stage">
              <div className="stage-zoom">
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
              </div>
            </div>
          </section>
          <TimelineBar
            view={tl}
            verdict={stage.input.verdict}
            profile={stage.input.profile}
            day={day}
            concluded={scene.concluded}
            reduced={settings.reduced}
          />
          <div style={{ marginTop: 12 }} id={STAFF_SECTION.measures}>
            <MeasurePanel
              measures={knowledge.measures}
              selected={measureIds}
              verdict={evaluation?.verdict}
              graph={graphNow}
              costs={evaluation?.measureCosts}
              onToggle={app.toggleMeasure}
              onClear={app.clearMeasures}
              disabled={busy}
            />
          </div>
          <Collapsible id={STAFF_SECTION.industry} title="業界の切り替え" plain={demo}>
            <IndustrySwitch />
          </Collapsible>
          <Collapsible
            id={STAFF_SECTION.ai}
            title="AI 攻撃者"
            plain={demo}
            forceOpen={ai.busy}
            badge={ai.busy ? "実行中" : ai.ran ? "実行済み" : undefined}
          >
            <AiAttackerPanel
              graph={stage.input.graph}
              verdict={evaluation?.verdict ?? stage.input.verdict}
              labels={knowledge.labels}
              measures={knowledge.measures}
              reduced={settings.reduced}
            />
          </Collapsible>
          <Collapsible
            id={STAFF_SECTION.comparison}
            title="比較"
            plain={demo}
            forceOpen={ai.compareBusy}
          >
            <ComparisonPanel />
          </Collapsible>
          {caseMeta?.series && (
            <Collapsible id={STAFF_SECTION.series} title="続報" plain={demo}>
              <SeriesPanel series={caseMeta.series} />
            </Collapsible>
          )}
          <Collapsible
            id={STAFF_SECTION.evidence}
            title="根拠"
            plain={demo}
            legacyId={STAFF_SECTION.evidence}
          >
            <EvidencePanel
              verdict={stage.input.verdict}
              theCase={theCase}
              profile={stage.input.profile}
              labels={knowledge.labels}
              graph={stage.input.graph}
              templates={knowledge.templates}
              {...(caseMeta?.series ? { quoteSources: caseMeta.series.quoteSources } : {})}
            />
          </Collapsible>
          <Collapsible
            id={STAFF_SECTION.requests}
            title="確認依頼"
            plain={demo}
            legacyId={STAFF_SECTION.requests}
            forceOpen={requestsOpen}
            contains={[STAFF_SECTION.outbox]}
            badge={[
              counts.pending > 0 && `未確認 ${counts.pending} 件`,
              counts.waiting > 0 && `依頼済み ${counts.waiting} 件`,
              counts.answered > 0 && `回答あり ${counts.answered} 件`,
            ]
              .filter(Boolean)
              .join("　")}
          >
            <RequestPanel />
          </Collapsible>
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
