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

/** 結論カードの数字タイル 1 枚。値は engine の Verdict.impact をそのまま写す（計算はしない） */
export type ImpactTile = {
  key: "stop" | "revenue" | "money" | "partner" | "report";
  /** 短いラベル（「停止」「売上影響」「取引先」「報告義務」） */
  label: string;
  value: string;
  /** 小さく添える語（止まる業務の名前、報告対象の件数など） */
  sub?: string;
  /** 被害が出る（強調する）か。「なし」は弱く出す */
  hot: boolean;
};

const NONE = "なし";

/**
 * 結論カードの数字タイル。入口なし・対象外では出さない（結論の文だけで足りる）。
 * 止められる結論でも「なし」のタイルを並べ、何も起きないことを数字で示す
 */
export function impactTiles(v: Verdict, yenJa: (n: number | undefined) => string): ImpactTile[] {
  if (v.result === "no_entry" || v.result === "out_of_scope" || v.coverageGapJa) return [];
  const i = v.impact;
  const longest = [...i.stopped].sort((a, b) => b.days - a.days)[0];
  const tiles: ImpactTile[] = [
    {
      key: "stop",
      label: "停止",
      value: i.downtimeDays > 0 ? `${i.downtimeDays}日` : NONE,
      ...(i.downtimeDays > 0 && longest ? { sub: longest.name } : {}),
      hot: i.downtimeDays > 0,
    },
    {
      key: "revenue",
      label: "売上影響",
      value: i.revenueImpactJpy ? yenJa(i.revenueImpactJpy) : NONE,
      hot: Boolean(i.revenueImpactJpy),
    },
  ];
  if (i.moneyLossJpy)
    tiles.push({ key: "money", label: "流出", value: yenJa(i.moneyLossJpy), hot: true });
  tiles.push(
    {
      key: "partner",
      label: "取引先",
      value: i.partnerImpactDay !== undefined ? `${i.partnerImpactDay}日目` : NONE,
      hot: i.partnerImpactDay !== undefined,
    },
    reportTile(v),
  );
  return tiles;
}

function reportTile(v: Verdict): ImpactTile {
  const i = v.impact;
  if (!i.reportRequired) return { key: "report", label: "報告義務", value: NONE, hot: false };
  const reached = i.personalDataReached;
  const parts: string[] = [];
  if (reached.some((p) => p.sensitive)) parts.push("要配慮");
  const counts = reached.map((p) => p.count);
  if (counts.length > 0 && counts.every((c): c is number => c !== undefined)) {
    parts.push(`${counts.reduce((a, b) => a + b, 0).toLocaleString("ja-JP")}件`);
  } else if (reached.some((p) => p.over1000)) {
    parts.push("1,000人超");
  }
  return {
    key: "report",
    label: "報告義務",
    value: "あり",
    ...(parts.length > 0 ? { sub: parts.join("・") } : {}),
    hot: true,
  };
}

/** 段階の帯の 1 マス（本線の段階。構成要素の名前と状態） */
export type StripStage = {
  nodeId: string;
  /** 構成要素の名前（グラフのラベル） */
  label: string;
  state: PathStep["state"];
  /** 突破のときの型紙の言葉（「暗号化される」など）。無ければ共通の語 */
  breachedLabelJa?: string;
  /** 止まった段階より先（薄く出す） */
  beyond: boolean;
};

/**
 * 経路の本線の段階を並べる。同じ構成要素が続くときは 1 マスにまとめる（先の状態を採る）。
 * 「止まる」段階（blocked）に当たったら、それより先は beyond にする（実際には起きないため薄く出す）
 */
export function stageStrip(v: Verdict, graph: Graph): StripStage[] {
  const path = primaryPath(v);
  if (!path) return [];
  const label = (id: string) => graph.nodes.find((n) => n.id === id)?.label ?? id;
  const out: StripStage[] = [];
  let stopped = false;
  for (const s of mainSteps(path)) {
    const prev = out.at(-1);
    if (prev && prev.nodeId === s.nodeId) continue;
    out.push({
      nodeId: s.nodeId,
      label: label(s.nodeId),
      state: s.state,
      ...(s.breachedLabelJa ? { breachedLabelJa: s.breachedLabelJa } : {}),
      beyond: stopped,
    });
    if (s.state === "blocked") stopped = true;
  }
  return out;
}
