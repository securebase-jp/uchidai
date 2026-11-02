/**
 * 再生台本：判定結果（Verdict）と構成グラフから、時刻つきの出来事（Beat）の列を作る。
 * 描画はこの台本と再生時刻だけで決まる（判定はしない）。
 *
 * 速度の原則：侵入はゆっくり（1 区間 1〜2 秒）、業務への連鎖は速く（約 0.5 秒）、結論は動きを止める。
 */
import type { Tone } from "./labels.ts";
import { STATE_LABEL } from "./labels.ts";
import type {
  CompanyProfile,
  Graph,
  GraphEdge,
  Layer,
  MeasureDef,
  PathSource,
  StepState,
  Verdict,
} from "./types.ts";

export type Beat =
  | {
      t: number;
      dur: number;
      kind: "traverse";
      edgeId: string;
      from: string;
      to: string;
      pathId: string;
      source: PathSource;
      /** 効かない対策の盾を回り込む */
      curved: boolean;
      /** 止まる段階へ向かう（壁の手前で止まる） */
      blocked: boolean;
    }
  | {
      t: number;
      kind: "arrive";
      nodeId: string;
      state: StepState;
      pathId: string;
      source: PathSource;
      stepIndex: number;
      /** 適用した対策のうち、この段階では効かないもの */
      ineffective: { mitigation: string; reasonJa: string }[];
      /** 適用した対策のうち、この段階で効いたもの */
      effective: string[];
      technique?: string;
      labelJa?: string;
    }
  | { t: number; kind: "flash"; layer: Layer }
  | { t: number; dur: number; kind: "fall"; edgeId: string; from: string; to: string }
  | { t: number; kind: "hit"; nodeId: string; layer: Layer; tone: Tone; labelJa: string }
  | { t: number; dur: number; kind: "days"; to: number }
  | { t: number; kind: "conclude" }
  | { t: number; kind: "log"; text: string; tone: Tone; ai: boolean; technique?: string };

export type Script = {
  beats: Beat[];
  duration: number;
  primaryPathId?: string;
  /** 経路の線として描く区間（出来事が起きる前から薄く描く） */
  segments: { edgeId: string; from: string; to: string; pathId: string; source: PathSource }[];
};

const T = {
  entry: 1800,
  system: 1400,
  person: 1200,
  management: 900,
  revisit: 350,
  gap: 320,
  fall: 500,
  stagger: 140,
};

export function edgeBetween(graph: Graph, a: string, b: string): GraphEdge | undefined {
  return graph.edges.find((e) => (e.from === a && e.to === b) || (e.from === b && e.to === a));
}

const RESULT_WORD: Record<StepState, string> = {
  breached: "成功",
  recoverable: "成功（ただし復旧できる）",
  unknown: "結果不明（確認待ち）",
  human: "相手の判断待ち",
  blocked: "失敗",
};

export type ScriptOptions = {
  applied?: MeasureDef[];
  techniqueLabel?: (id: string) => string;
};

export function buildScript(
  graph: Graph,
  verdict: Verdict,
  _profile: CompanyProfile,
  opts: ScriptOptions = {},
): Script {
  const beats: Beat[] = [];
  const segments: Script["segments"] = [];
  const appliedMitigations = new Set((opts.applied ?? []).map((m) => m.mitigation));
  const nodeOf = (id: string) => graph.nodes.find((n) => n.id === id);
  const tl = opts.techniqueLabel ?? ((id: string) => id);
  let t = 400;
  const visited = new Map<string, StepState>();
  const attacker = graph.nodes.find((n) => n.role === "attacker")?.id ?? "attacker";

  const paths = [...verdict.paths].sort(
    (a, b) => Number(a.source === "ai") - Number(b.source === "ai"),
  );
  const primary = paths.find((p) => p.source !== "ai") ?? paths[0];

  for (const path of paths) {
    const ai = path.source === "ai";
    if (ai) {
      beats.push({
        t,
        kind: "log",
        text: "── AI攻撃者が見つけた別の経路（検証済み）──",
        tone: "cyan",
        ai: true,
      });
      t += T.gap;
    }
    let prev = attacker;
    for (let i = 0; i < path.steps.length; i++) {
      const step = path.steps[i];
      if (!step) break;
      const node = nodeOf(step.nodeId);
      if (!node) continue;
      const stepSource: PathSource = step.source;
      const ineffective = step.ineffective.filter((x) => appliedMitigations.has(x.mitigation));
      const effective = step.mitigations.filter((m) => appliedMitigations.has(m));
      if (prev !== step.nodeId) {
        const edge = edgeBetween(graph, prev, step.nodeId);
        const edgeId = edge?.id ?? `${prev}~${step.nodeId}`;
        segments.push({ edgeId, from: prev, to: step.nodeId, pathId: path.id, source: stepSource });
        const already = visited.has(step.nodeId);
        const dur = already
          ? T.revisit
          : node.layer === "management"
            ? T.management
            : node.side === "person"
              ? T.person
              : i === 0
                ? T.entry
                : T.system;
        beats.push({
          t,
          dur,
          kind: "traverse",
          edgeId,
          from: prev,
          to: step.nodeId,
          pathId: path.id,
          source: stepSource,
          curved: ineffective.length > 0 && step.state !== "blocked",
          blocked: step.state === "blocked",
        });
        const logT = t + Math.min(400, dur / 3);
        const techniqueText = step.technique
          ? `${step.technique} ${tl(step.technique)}`
          : (step.labelJa ?? "");
        const target = node.label;
        const tail =
          ineffective.length > 0
            ? `${RESULT_WORD[step.state]}（${ineffective.map((x) => x.reasonJa).join("。")}）`
            : RESULT_WORD[step.state];
        beats.push({
          t: logT,
          kind: "log",
          text: `${techniqueText} → ${target} … ${tail}`,
          tone: step.state === "blocked" ? "green" : step.state === "breached" ? "red" : "amber",
          ai,
          ...(step.technique ? { technique: step.technique } : {}),
        });
        t += dur;
      }
      beats.push({
        t,
        kind: "arrive",
        nodeId: step.nodeId,
        state: step.state,
        pathId: path.id,
        source: stepSource,
        stepIndex: i,
        ineffective,
        effective,
        ...(step.technique ? { technique: step.technique } : {}),
        ...(step.labelJa ? { labelJa: step.labelJa } : {}),
      });
      visited.set(step.nodeId, step.state);
      prev = step.nodeId;
      t += step.state === "blocked" ? 900 : T.gap;
      if (step.state === "blocked") {
        beats.push({
          t: t - 600,
          kind: "log",
          text: `${node.label} で止められた（${STATE_LABEL.blocked}）。この経路はあきらめる`,
          tone: "green",
          ai,
        });
        break;
      }
    }
    if (path.reachedCore) {
      beats.push({
        t: t - T.gap + 100,
        kind: "log",
        text: "到達。身代金の要求、または送金の完了",
        tone: "red",
        ai,
      });
    }
    t += T.gap;
  }

  // 業務と経営への連鎖（中核に到達した経路があるとき）
  const reached = paths.filter((p) => p.reachedCore);
  if (reached.length > 0) {
    const reachedAssets = new Set(reached.flatMap((p) => p.reachedAssetIds));
    for (const p of reached)
      for (const s of p.steps) if (s.state === "breached") reachedAssets.add(s.nodeId);
    const stoppedIds = new Set(verdict.impact.stopped.map((s) => s.businessId));
    const bizNodes = graph.nodes.filter((n) => n.layer === "business");
    const affectedBiz = bizNodes.filter((b) =>
      graph.edges.some((e) => e.kind === "depends" && e.from === b.id && reachedAssets.has(e.to)),
    );
    if (affectedBiz.length > 0) {
      beats.push({ t, kind: "flash", layer: "business" });
      affectedBiz.forEach((b, i) => {
        const dep = graph.edges.find(
          (e) => e.kind === "depends" && e.from === b.id && reachedAssets.has(e.to),
        );
        const start = t + i * T.stagger;
        if (dep)
          beats.push({
            t: start,
            dur: T.fall,
            kind: "fall",
            edgeId: dep.id,
            from: dep.to,
            to: b.id,
          });
        const stopped = stoppedIds.has(b.id);
        beats.push({
          t: start + T.fall,
          kind: "hit",
          nodeId: b.id,
          layer: "business",
          tone: stopped ? "red" : "amber",
          labelJa: stopped ? "停止" : "影響あり",
        });
      });
      t += T.fall + affectedBiz.length * T.stagger + 200;
    }

    const mgmtHits: { nodeId: string; tone: Tone; labelJa: string; from?: string }[] = [];
    const mgmtNode = (id: string) =>
      graph.nodes.find((n) => n.id === id && n.layer === "management");
    const fromBiz = (target: string) =>
      graph.edges.find((e) => e.kind === "impacts" && e.to === target && stoppedIds.has(e.from))
        ?.from;
    const partner = mgmtNode("impact.partner");
    const partnerFrom = partner ? fromBiz(partner.id) : undefined;
    if (partner && partnerFrom)
      mgmtHits.push({ nodeId: partner.id, tone: "red", labelJa: "影響が出る", from: partnerFrom });
    const revenue = mgmtNode("impact.revenue");
    const revenueFrom = revenue ? fromBiz(revenue.id) : undefined;
    if (revenue && verdict.impact.revenueImpactJpy)
      mgmtHits.push({
        nodeId: revenue.id,
        tone: "red",
        labelJa: "売上が減る",
        ...(revenueFrom ? { from: revenueFrom } : {}),
      });
    const legal = mgmtNode("impact.legal");
    if (legal && verdict.impact.reportRequired) {
      const src = graph.edges.find(
        (e) => e.kind === "impacts" && e.to === legal.id && reachedAssets.has(e.from),
      )?.from;
      mgmtHits.push({
        nodeId: legal.id,
        tone: "amber",
        labelJa: "法律上の義務",
        ...(src ? { from: src } : {}),
      });
    }
    const alreadyHit = new Set(
      beats.filter((b) => b.kind === "arrive").map((b) => (b as { nodeId: string }).nodeId),
    );
    const hits = mgmtHits.filter((h) => !alreadyHit.has(h.nodeId));
    if (hits.length > 0) {
      beats.push({ t, kind: "flash", layer: "management" });
      hits.forEach((h, i) => {
        const start = t + i * T.stagger;
        if (h.from) {
          const e = edgeBetween(graph, h.from, h.nodeId);
          if (e)
            beats.push({
              t: start,
              dur: T.fall,
              kind: "fall",
              edgeId: e.id,
              from: h.from,
              to: h.nodeId,
            });
        }
        beats.push({
          t: start + T.fall,
          kind: "hit",
          nodeId: h.nodeId,
          layer: "management",
          tone: h.tone,
          labelJa: h.labelJa,
        });
      });
      t += T.fall + hits.length * T.stagger + 200;
    }
    const days = verdict.impact.downtimeDays;
    if (days > 0) {
      const dur = Math.min(3200, 600 + days * 220);
      beats.push({ t, dur, kind: "days", to: days });
      t += dur + 300;
    }
  } else {
    t += 400;
  }
  beats.push({ t, kind: "conclude" });
  beats.sort((a, b) => a.t - b.t);
  return {
    beats,
    duration: t + 100,
    ...(primary ? { primaryPathId: primary.id } : {}),
    segments,
  };
}

/** 再生時刻 now までに起きた出来事の数（beats は時刻順） */
export function firedCount(beats: { t: number }[], now: number): number {
  let lo = 0;
  let hi = beats.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((beats[mid]?.t ?? Number.POSITIVE_INFINITY) <= now) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export type NodeVisual = {
  state?: StepState;
  tone?: Tone;
  tagJa?: string;
  ineffective: { mitigation: string; reasonJa: string }[];
  effective: string[];
  technique?: string;
  /** 突破・被弾の出来事が起きた時刻（揺れなどの一回きりの演出に使う） */
  hitAt?: number;
};
export type EdgeVisual = "calm" | "attack" | "dead" | "fallen" | "blocked";
export type Scene = {
  nodes: Record<string, NodeVisual>;
  edges: Record<string, EdgeVisual>;
  flashes: { layer: Layer; at: number }[];
  concluded: boolean;
  walls: string[];
  logs: { text: string; tone: Tone; ai: boolean; at: number; technique?: string }[];
  daysTo: number;
  daysBeat?: { t: number; dur: number; to: number };
};

/** 起きた出来事から、いまの見た目（状態の集合）を組み立てる */
export function sceneAt(script: Script, graph: Graph, fired: number): Scene {
  const scene: Scene = {
    nodes: {},
    edges: {},
    flashes: [],
    concluded: false,
    walls: [],
    logs: [],
    daysTo: 0,
  };
  const node = (id: string) => (scene.nodes[id] ??= { ineffective: [], effective: [] });
  const deadAround = (id: string) => {
    for (const e of graph.edges) {
      if (e.from !== id && e.to !== id) continue;
      if (scene.edges[e.id] === "attack" || scene.edges[e.id] === "fallen") continue;
      scene.edges[e.id] = "dead";
    }
  };
  for (let i = 0; i < fired; i++) {
    const b = script.beats[i];
    if (!b) break;
    switch (b.kind) {
      case "traverse":
        if (!b.blocked) scene.edges[b.edgeId] = "attack";
        else scene.edges[b.edgeId] = "blocked";
        break;
      case "arrive": {
        const n = node(b.nodeId);
        n.state = b.state;
        n.tone =
          b.state === "breached"
            ? "red"
            : b.state === "unknown" || b.state === "human"
              ? "amber"
              : "green";
        n.tagJa = STATE_LABEL[b.state];
        n.ineffective = b.ineffective;
        n.effective = b.effective;
        if (b.technique) n.technique = b.technique;
        n.hitAt = b.t;
        if (b.state === "breached") deadAround(b.nodeId);
        if (b.state === "blocked") scene.walls.push(b.nodeId);
        break;
      }
      case "flash":
        scene.flashes.push({ layer: b.layer, at: b.t });
        break;
      case "fall":
        scene.edges[b.edgeId] = "fallen";
        break;
      case "hit": {
        const n = node(b.nodeId);
        n.tone = b.tone;
        n.tagJa = b.labelJa;
        n.hitAt = b.t;
        if (b.tone === "red") deadAround(b.nodeId);
        break;
      }
      case "days":
        scene.daysTo = b.to;
        scene.daysBeat = { t: b.t, dur: b.dur, to: b.to };
        break;
      case "conclude":
        scene.concluded = true;
        break;
      case "log":
        scene.logs.push({
          text: b.text,
          tone: b.tone,
          ai: b.ai,
          at: b.t,
          ...(b.technique ? { technique: b.technique } : {}),
        });
        break;
    }
  }
  return scene;
}
