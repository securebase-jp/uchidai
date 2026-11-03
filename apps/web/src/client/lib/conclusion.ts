/**
 * 結論カードの材料。判定はしない（判定結果と構成グラフを読んで文と並びを作るだけ）。
 * - reasonSentence：結論の理由を一文で（突破された入口と到達先、または止まった場所）
 * - NextMove：次の一手の型（選ぶのは engine の effectiveMeasures。/api/evaluate が返す）
 */
import type { AttackPath, Graph, MeasureDef, PathStep, Verdict } from "./types.ts";

/** 判定の本線（AI の経路は除く。中核まで届いた経路を優先） */
export function primaryPath(v: Verdict): AttackPath | undefined {
  return (
    v.paths.find((p) => p.source !== "ai" && p.reachedCore) ??
    v.paths.find((p) => p.source !== "ai") ??
    v.paths[0]
  );
}

const mainSteps = (p: AttackPath): PathStep[] =>
  p.steps.filter((s) => !s.precondition && !s.branch);

/**
 * 理由の一文。例：「VPN装置（公開アプリケーションの悪用）から入られ、生産管理システムまで届きます」
 * 入口なし・対象外のときは空（結論の文だけで足りる）
 */
export function reasonSentence(
  v: Verdict,
  graph: Graph,
  techniques: Record<string, string> = {},
): string {
  const label = (id: string) => graph.nodes.find((n) => n.id === id)?.label ?? id;
  const path = primaryPath(v);
  if (!path) return "";
  const steps = mainSteps(path);
  const entry = steps[0];
  if (!entry) return "";
  const how = entry.technique ? techniques[entry.technique] : undefined;
  const from = `${label(entry.nodeId)}${how ? `（${how}）` : ""}`;
  switch (v.result) {
    case "breached": {
      const last = [...steps].reverse().find((s) => s.state === "breached") ?? steps.at(-1);
      return last && last !== entry
        ? `${from}から入られ、${label(last.nodeId)}まで届きます`
        : `${from}から入られます`;
    }
    case "mitigated": {
      const rec = steps.find((s) => s.state === "recoverable");
      return rec
        ? `${from}から入られますが、${label(rec.nodeId)}は復旧できます`
        : `${from}から入られますが、被害は抑えられます`;
    }
    case "blocked": {
      const stop = steps.find((s) => s.state === "blocked");
      if (!stop) return "この攻撃は途中で止まります";
      return `${label(stop.nodeId)}で止まります${stop.reasonJa ? `（${stop.reasonJa}）` : ""}`;
    }
    case "pending": {
      const unknown = [
        ...new Set(
          steps
            .filter((s) => s.state === "unknown" || s.state === "human")
            .map((s) => label(s.nodeId)),
        ),
      ];
      return unknown.length > 0
        ? `${from}から入られ、${unknown.join("・")}の段階が未確認です`
        : `${from}から入られますが、未確認の項目が残っています`;
    }
    default:
      return "";
  }
}

/** 次の一手の 1 件（対策と、効く段階のラベル）。選ぶのはサーバ側の engine（/api/evaluate の nextMoves） */
export type NextMove = { measure: MeasureDef; stageJa?: string };
