/**
 * 結論カードの材料。判定はしない（判定結果と構成グラフを読んで文と並びを作るだけ）。
 * - reasonSentence：結論の理由を一文で（突破された入口と到達先、または止まった場所）
 * - nextMoves：いまの経路の段階に効く対策を、入口に近い段階で効くものから順に（適用中のものは除く）
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

export type NextMove = { measure: MeasureDef; stageJa?: string };

/**
 * 次の一手：いまの判定の段階（止まっていない段階）で効く対策を、早い段階で効くものから順に。
 * 効かない対策（ineffective）と適用中の対策は除く。同じ段階なら対策ボタンの並び順
 */
export function nextMoves(
  measures: MeasureDef[],
  v: Verdict,
  selected: string[],
  limit = 3,
): NextMove[] {
  const steps = v.paths
    .filter((p) => p.source !== "ai")
    .flatMap((p) => mainSteps(p).map((s, index) => ({ s, index })))
    .filter(({ s }) => s.state !== "blocked");
  const out: (NextMove & { index: number; order: number })[] = [];
  measures.forEach((measure, order) => {
    if (selected.includes(measure.id)) return;
    const roles = new Set(measure.patches.map((p) => p.role));
    const ids = new Set([measure.mitigation, ...measure.patches.map((p) => p.mitigation)]);
    const hit = steps
      .filter(
        ({ s }) =>
          roles.has(s.role) &&
          s.mitigations.some((m) => ids.has(m)) &&
          !s.ineffective.some((i) => ids.has(i.mitigation)),
      )
      .reduce<{ s: PathStep; index: number } | undefined>(
        (best, h) => (best === undefined || h.index < best.index ? h : best),
        undefined,
      );
    if (hit)
      out.push({
        measure,
        ...(hit.s.labelJa ? { stageJa: hit.s.labelJa } : {}),
        index: hit.index,
        order,
      });
  });
  return out
    .sort((a, b) => a.index - b.index || a.order - b.order)
    .slice(0, limit)
    .map(({ measure, stageJa }) => ({ measure, ...(stageJa ? { stageJa } : {}) }));
}
