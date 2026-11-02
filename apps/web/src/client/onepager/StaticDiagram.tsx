/** 経路図の静止画：既存の Diagram を、結論まで進めた場面で止めて描く（粒やログは描かない） */
import { useMemo } from "react";
import { Diagram } from "../components/Diagram.tsx";
import { layoutGraph } from "../lib/layout.ts";
import { buildScript, sceneAt } from "../lib/playback.ts";
import type { CompanyProfile, Graph, MeasureDef, Verdict } from "../lib/types.ts";

type Props = {
  graph: Graph;
  verdict: Verdict;
  profile: CompanyProfile;
  applied: MeasureDef[];
  measureLabel?: (mitigation: string) => string;
};

export function StaticDiagram({ graph, verdict, profile, applied, measureLabel }: Props) {
  const layout = useMemo(() => layoutGraph(graph), [graph]);
  const script = useMemo(
    () => buildScript(graph, verdict, profile, { applied }),
    [graph, verdict, profile, applied],
  );
  const scene = useMemo(() => sceneAt(script, graph, script.beats.length), [script, graph]);
  return (
    <figure className="op-figure" aria-label="攻撃の経路（結論の状態）">
      <Diagram
        layout={layout}
        graph={graph}
        scene={scene}
        script={script}
        profile={profile}
        showIds={false}
        {...(measureLabel ? { measureLabel } : {})}
      />
    </figure>
  );
}
