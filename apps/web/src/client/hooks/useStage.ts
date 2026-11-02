/**
 * 舞台：構成グラフ → 配置、判定結果 → 台本、時計 → 場面。
 * 判定結果が変わると時間を巻き戻してから新しい台本に切り替える（対策の再判定の演出）。
 */
import { useEffect, useMemo, useState } from "react";
import { type Layout, layoutGraph } from "../lib/layout.ts";
import { buildScript, type Scene, type Script, sceneAt } from "../lib/playback.ts";
import type { CompanyProfile, Graph, LabelsFile, MeasureDef, Verdict } from "../lib/types.ts";
import { type Clock, useClock } from "./useClock.ts";

export type StageInput = {
  graph: Graph;
  verdict: Verdict;
  profile: CompanyProfile;
  applied: MeasureDef[];
  labels?: LabelsFile;
};
export type Stage = {
  layout: Layout;
  script: Script;
  scene: Scene;
  clock: Clock;
  input: StageInput;
  /** 巻き戻し中か、新しい結果を待っているか */
  swapping: boolean;
};

const EMPTY: number[] = [];

export function useStage(
  next: StageInput | undefined,
  opts: { reduced: boolean; autoplay: boolean; speed?: number },
): Stage | undefined {
  const [active, setActive] = useState<StageInput | undefined>(next);
  const [pendingSwap, setPendingSwap] = useState(false);

  const layout = useMemo(() => (active ? layoutGraph(active.graph) : undefined), [active]);
  const script = useMemo(
    () =>
      active
        ? buildScript(active.graph, active.verdict, active.profile, {
            applied: active.applied,
            techniqueLabel: (id) => active.labels?.techniques[id] ?? "",
          })
        : undefined,
    [active],
  );
  const beatTimes = useMemo(() => script?.beats.map((b) => b.t) ?? EMPTY, [script]);
  const clockOpts = useMemo(
    () => ({
      reduced: opts.reduced,
      autoplay: opts.autoplay,
      ...(opts.speed !== undefined ? { speed: opts.speed } : {}),
    }),
    [opts.reduced, opts.autoplay, opts.speed],
  );
  const clock = useClock(beatTimes, script?.duration ?? 0, clockOpts);
  const { rewindThen } = clock;

  // 新しい判定結果：初回はそのまま、2 回目以降は巻き戻してから切り替える
  useEffect(() => {
    if (!next) return;
    if (!active) {
      setActive(next);
      return;
    }
    if (next === active) return;
    setPendingSwap(true);
    rewindThen(() => {
      setActive(next);
      setPendingSwap(false);
    });
  }, [next, active, rewindThen]);

  const scene = useMemo(
    () => (script && active ? sceneAt(script, active.graph, clock.fired) : undefined),
    [script, active, clock.fired],
  );

  if (!active || !layout || !script || !scene) return undefined;
  return { layout, script, scene, clock, input: active, swapping: pendingSwap || clock.rewinding };
}
