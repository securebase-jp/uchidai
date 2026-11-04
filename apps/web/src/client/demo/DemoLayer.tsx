/**
 * デモモード（?demo=1）。URL で起動し、demo/storyboard.json の順に画面の操作と演出を自動で進める。
 *   ?demo=1            最初から（開始ボタンを押す。音声の自動再生にはクリックが要る）
 *   &scene=4           場面 4 から
 *   &autostart=1       クリックなしで開始（音声が無いときや、録画の自動化向け）
 *   &captions=1        画面に字幕を出す（既定は出さない。動画には assemble.ts で焼き込む）
 *   &hud=1             右上に場面と時刻を出す（既定は出さない）
 *   &controls=0        画面下の操作バーと「一時停止中」の札を出さない（録画用。既定は出す）
 *   &police=1|0        場面 3 の警察庁の数字の小さな表示を出す／出さない（既定は storyboard.json の options）
 * キー：Space 一時停止／再開、→ 次の場面、← 前の場面、H 表示切替、C 字幕切替
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../hooks/useApp.tsx";
import { api } from "../lib/api.ts";
import { demoClock, withDemoClock } from "./bridge.ts";
import { DemoControls } from "./DemoControls.tsx";
import { buildScenes, cueAt, type DemoScene, narration, storyboard } from "./data.ts";
import { EndCard } from "./EndCard.tsx";
import { LayerStack, showTap, useZoomLayer } from "./layers.tsx";
import { BuildOverlay } from "./overlays/Build.tsx";
import { ChatOverlay } from "./overlays/Chat.tsx";
import { ConclusionOverlay } from "./overlays/Conclusion.tsx";
import { DeclarationOverlay } from "./overlays/Declaration.tsx";
import { ReadingOverlay } from "./overlays/Reading.tsx";
import { type DemoParams, parseDemoParams } from "./params.ts";
import type { DemoAction, DemoAnswer, OverlayId } from "./schema.ts";
import { SLOTS, type SlotId, SlotPlaceholder } from "./slots.tsx";
import { useDemoPlayer } from "./useDemoPlayer.ts";
import "./demo.css";

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** この overlay が出ている終わりの時刻：次の overlay 操作の時刻（無ければ場面の終わり） */
function overlayEnd(scene: DemoScene, since: number, sceneSeconds: number): number {
  const next = scene.board.actions
    .filter((a) => a.do === "overlay" && a.at > since)
    .map((a) => a.at);
  return next.length > 0 ? Math.min(...next) : sceneSeconds;
}

/** セレクタに合う要素から、text を含むものの nth 番目（絵コンテの click / fill の対象） */
function pick(selector: string, nth = 0, text?: string): Element | undefined {
  const all = [...document.querySelectorAll(selector)].filter(
    (e) => text === undefined || (e.textContent ?? "").includes(text),
  );
  return all[nth];
}

export function DemoLayer() {
  const params = useMemo(() => parseDemoParams(), []);
  if (!params.on) return null;
  return <DemoRunner {...params} />;
}

function DemoRunner({
  startIndex,
  autostart,
  captions: captionsDefault,
  hud: hudDefault,
  controls,
  police,
}: DemoParams) {
  const app = useApp();
  const appRef = useRef(app);
  appRef.current = app;
  const [scenes, setScenes] = useState<DemoScene[]>();
  // overlay は、いつから出ているか（since、場面の経過秒数）を持つ。部品の時刻は出た時点を 0 とする
  const [overlay, setOverlayState] = useState<{ id: OverlayId; since: number }>({
    id: "none",
    since: 0,
  });
  const setOverlay = useCallback((id: OverlayId, since = 0) => setOverlayState({ id, since }), []);
  const flags = useMemo(() => ({ policeStat: police ?? storyboard.options.policeStat }), [police]);
  const [captions, setCaptions] = useState(captionsDefault);
  const [hud, setHud] = useState(hudDefault);
  const [ready, setReady] = useState(false);

  // 音声の有無を調べてから場面を組む（原稿と絵コンテの食い違いはここで分かる）
  const [setupError, setSetupError] = useState<string>();
  useEffect(() => {
    api
      .demoAudio()
      .then((r) => setScenes(buildScenes(r.available)))
      .catch(() => setScenes(buildScenes({})))
      .catch((e: unknown) => setSetupError(e instanceof Error ? e.message : String(e)));
  }, []);

  // デモ用のカルテと事例をそろえる
  useEffect(() => {
    if (app.profile?.id !== storyboard.profile) void app.loadExample(storyboard.profile);
  }, [app.profile?.id, app.loadExample]);
  useEffect(() => {
    if (app.caseMeta?.recorded?.caseId !== storyboard.case) void app.loadRecorded(storyboard.case);
  }, [app.caseMeta?.recorded?.caseId, app.loadRecorded]);
  useEffect(() => {
    setReady(
      Boolean(
        scenes &&
          app.profile?.id === storyboard.profile &&
          app.caseMeta?.recorded?.caseId === storyboard.case &&
          app.knowledge,
      ),
    );
  }, [scenes, app.profile?.id, app.caseMeta?.recorded?.caseId, app.knowledge]);

  useEffect(() => {
    document.documentElement.dataset.demo = "1";
    return () => {
      delete document.documentElement.dataset.demo;
    };
  }, []);

  const setMeasures = useCallback((ids: string[]) => {
    const a = appRef.current;
    if (same(a.measureIds, ids)) return;
    a.clearMeasures();
    for (const id of ids) a.toggleMeasure(id);
  }, []);
  const setAnswers = useCallback((list: DemoAnswer[]) => {
    const a = appRef.current;
    if (same(a.answers, list)) return;
    a.clearAnswers();
    for (const x of list) a.addAnswer(x);
  }, []);

  const exec = useCallback(
    (action: DemoAction) => {
      switch (action.do) {
        case "route":
          if (location.hash !== action.to) location.hash = action.to;
          break;
        case "overlay":
          setOverlay(action.id, action.at);
          break;
        case "clock":
          withDemoClock((clock) => {
            if (action.speed !== undefined) clock.setSpeed(action.speed);
            if (action.cmd === "play") clock.play();
            else if (action.cmd === "pause") clock.pause();
            else if (action.cmd === "toEnd") clock.toEnd();
            else if (action.cmd === "restart") clock.restart();
          });
          break;
        case "measures":
          setMeasures(action.ids);
          break;
        case "answers":
          setAnswers(action.list);
          break;
        case "reset":
          setMeasures([]);
          setAnswers([]);
          break;
        case "scroll":
          if (action.to === "top") window.scrollTo({ top: 0, behavior: "smooth" });
          else
            document
              .querySelector(action.to)
              ?.scrollIntoView({ behavior: "smooth", block: action.block ?? "center" });
          break;
        case "click": {
          const el = pick(action.target, action.nth, action.text);
          if (el instanceof HTMLElement) {
            showTap(el);
            el.click();
          }
          break;
        }
        case "fill": {
          const el = pick(action.target, action.nth);
          if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
            showTap(el);
            const proto =
              el instanceof HTMLInputElement
                ? HTMLInputElement.prototype
                : HTMLTextAreaElement.prototype;
            Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, action.value);
            el.dispatchEvent(new Event("input", { bubbles: true }));
          }
          break;
        }
      }
    },
    [setMeasures, setAnswers, setOverlay],
  );

  const player = useDemoPlayer(scenes ?? [], {
    onEnter: (scene) => {
      if (location.hash !== scene.board.route) location.hash = scene.board.route;
      setOverlay(scene.board.overlay);
    },
    onAction: exec,
    onFinish: () => setOverlay("endcard-close"),
  });

  // 図への寄り（担当者画面の構成図をノードに寄せる）
  useZoomLayer(player.scene?.board.layers ?? [], player.elapsed, flags);

  // 一時停止は画面の再生時計（経路の再生）も止め、再開で元の状態に戻す
  const clockWasPlaying = useRef(false);
  const togglePause = useCallback(() => {
    const clock = demoClock();
    if (player.paused) {
      if (clock && clockWasPlaying.current) clock.play();
    } else {
      clockWasPlaying.current = clock?.playing ?? false;
      clock?.pause();
    }
    player.togglePause();
  }, [player]);

  // キー操作
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      // 操作バーのボタンにフォーカスがあるとき、Space はそのボタンの押下として働く
      if (e.code === "Space" && e.target instanceof Element && e.target.closest(".demo-controls"))
        return;
      if (e.code === "Space") {
        e.preventDefault();
        if (player.started) togglePause();
      } else if (e.key === "ArrowRight") player.next();
      else if (e.key === "ArrowLeft") player.prev();
      else if (e.key === "h" || e.key === "H") setHud((v) => !v);
      else if (e.key === "c" || e.key === "C") setCaptions((v) => !v);
    };
    addEventListener("keydown", on);
    return () => removeEventListener("keydown", on);
  }, [player, togglePause]);

  // 自動開始
  const autostarted = useRef(false);
  useEffect(() => {
    if (ready && autostart && !autostarted.current && !player.started) {
      autostarted.current = true;
      player.start(startIndex);
    }
  }, [ready, autostart, player, startIndex]);

  const scene = player.scene;
  const audioCount = scenes?.filter((s) => s.audioUrl).length ?? 0;
  const total = scenes?.reduce((n, s) => n + s.seconds, 0) ?? 0;

  return (
    <>
      {!player.started && (
        <div className="demo-gate">
          <div className="demo-gate-card">
            <p className="demo-kicker">デモモード</p>
            <h1>ウチダイ　3 分のデモ</h1>
            <p className="muted">
              {scenes
                ? `${scenes.length} 場面・約 ${Math.round(total)} 秒。音声：${
                    audioCount > 0
                      ? `${audioCount} / ${scenes.length} 場面`
                      : "なし（原稿の秒数で進みます）"
                  }`
                : "準備しています…"}
            </p>
            <ol className="demo-scenes">
              {scenes?.map((s) => (
                <li key={s.n}>
                  <button
                    type="button"
                    className="btn ghost sm"
                    onClick={() => player.start(s.index)}
                  >
                    {s.n}. {s.script.titleJa}
                    <span className="mono">{Math.round(s.seconds)}s</span>
                  </button>
                </li>
              ))}
            </ol>
            <button
              type="button"
              className="btn primary demo-start"
              disabled={!ready}
              onClick={() => player.start(startIndex)}
            >
              {ready ? `開始（場面 ${startIndex + 1} から）` : "カルテと事例を読み込んでいます…"}
            </button>
            {(app.error || setupError) && (
              <p className="err small" role="alert">
                {setupError ?? app.error}。API（pnpm dev）が動いているか確かめてください
              </p>
            )}
            <p className="muted small">
              Space 一時停止／再開　→ 次の場面　← 前の場面　H 右上の表示　C 字幕
              <br />
              再生中は、画面の下のバーでも操作できます（マウスを動かすと出ます）。
            </p>
          </div>
        </div>
      )}

      {scene && overlay.id !== "none" && (
        <Overlay
          id={overlay.id}
          scene={scene}
          elapsed={Math.max(0, player.elapsed - overlay.since)}
          seconds={Math.max(0.1, overlayEnd(scene, overlay.since, player.seconds) - overlay.since)}
        />
      )}
      {scene && <LayerStack layers={scene.board.layers} elapsed={player.elapsed} flags={flags} />}
      {player.finished && <EndCard phase="close" credits={narration.credits} elapsed={999} />}

      {controls && scene && !player.finished && (
        <DemoControls
          paused={player.paused}
          n={scene.n}
          total={scenes?.length ?? 0}
          onPrev={player.prev}
          onNext={player.next}
          onTogglePause={togglePause}
        />
      )}

      {captions && scene && (
        <div className="demo-caption" aria-live="off">
          <span>{cueAt({ ...scene, seconds: player.seconds }, player.elapsed)}</span>
        </div>
      )}

      {hud && (
        <div className="demo-hud mono" aria-hidden="true">
          {scene ? (
            <>
              <b>
                {scene.n}/{scenes?.length ?? 0}
              </b>{" "}
              {scene.script.titleJa}　{player.elapsed.toFixed(1)}/{player.seconds.toFixed(1)}s
              {player.paused ? "　‖" : "　▶"}
              {scene.fromAudio ? "　♪" : ""}
              {player.audioBlocked ? "　音声は再生できませんでした（クリックしてから開始）" : ""}
            </>
          ) : player.finished ? (
            "終了"
          ) : (
            "待機"
          )}
        </div>
      )}
    </>
  );
}

function Overlay({
  id,
  scene,
  elapsed,
  seconds,
}: {
  id: OverlayId;
  scene: DemoScene;
  elapsed: number;
  seconds: number;
}) {
  if (id === "chat-boss" || id === "chat-staff" || id === "chat-reply")
    return <ChatOverlay variant={id} elapsed={elapsed} seconds={seconds} />;
  if (id === "declaration") return <DeclarationOverlay elapsed={elapsed} />;
  if (id === "reading") return <ReadingOverlay elapsed={elapsed} seconds={seconds} />;
  if (id === "build") return <BuildOverlay elapsed={elapsed} />;
  if (id === "conclusion") return <ConclusionOverlay elapsed={elapsed} />;
  if (id === "endcard-roles" || id === "endcard-trace" || id === "endcard-close")
    return (
      <EndCard
        phase={id.slice("endcard-".length) as "roles" | "trace" | "close"}
        credits={narration.credits}
        elapsed={elapsed}
      />
    );
  if (id.startsWith("slot:")) {
    const sid = id as SlotId;
    const C = SLOTS[sid];
    const props = { elapsed, seconds, onScreen: scene.script.onScreen };
    // 外部確認の再生は、下のホーム画面が枠の外に見えないよう、黒地を敷く
    return (
      <>
        {sid === "slot:recon" && <div className="demo-overlay" aria-hidden="true" />}
        {C ? <C {...props} /> : <SlotPlaceholder id={sid} {...props} />}
      </>
    );
  }
  return null;
}
