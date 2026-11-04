/** 段階の帯：経路の本線の段階（構成要素の名前と状態のアイコン）を横一列に。止まった段階より先は薄く */
import { stageStrip } from "../lib/conclusion.ts";
import type { Graph, Verdict } from "../lib/types.ts";
import { StatusIcon } from "./StatusIcon.tsx";

export function StageStrip({ verdict, graph }: { verdict: Verdict; graph: Graph }) {
  const stages = stageStrip(verdict, graph);
  if (stages.length === 0) return null;
  return (
    <ol className="vt-strip" aria-label="攻撃の経路の段階">
      {stages.map((s) => (
        <li key={s.nodeId} className={`vt-stage st-${s.state}${s.beyond ? " beyond" : ""}`}>
          <span className="vt-stage-name">{s.label}</span>
          <StatusIcon
            state={s.state}
            showLabel
            {...(s.state === "breached" && s.breachedLabelJa ? { labelJa: s.breachedLabelJa } : {})}
          />
        </li>
      ))}
    </ol>
  );
}
