/**
 * 未確認の緩和策の並べ替えと、型紙の見出しを決める純粋な関数。
 * - rankPending：いまの判定の経路（AI の経路は除く）に出ている未確認を先頭に、答えると結論が変わりやすい順に並べる。
 *   入口に近い段階ほど先（入口で止まれば後ろの段階は問われない）。判定そのものはしない
 * - templateHeading：型紙を 1 本に絞れたときはその名前、入口不明で複数の型紙を展開したときは経路ごとの型紙を全部出す
 */
import type { AttackPath, CompanyProfile, Graph, Verdict } from "./types.ts";

export type PendingItem = {
  assetId: string;
  assetLabel: string;
  mitigation: string;
  /** この緩和策が、いまの判定の経路のどこかの段階で「効く緩和策」として問われている */
  onPath: boolean;
  /** 問われている段階の見出し（型紙の labelJa）。複数あれば入口に近いもの */
  stageJa?: string;
  /** 経路の中での位置（0 が入口）。経路の外は undefined */
  position?: number;
};

/** 資産 ID → 経路の中で問われている位置と段階名（最も入口に近いもの） */
function askedOnPath(
  verdict: Verdict | undefined,
  graph: Graph | undefined,
): Map<string, { position: number; stageJa?: string }> {
  const asked = new Map<string, { position: number; stageJa?: string }>();
  if (!verdict) return asked;
  const assetOf = (nodeId: string) => graph?.nodes.find((n) => n.id === nodeId)?.assetId ?? nodeId;
  for (const p of verdict.paths) {
    if (p.source === "ai") continue;
    p.steps.forEach((s, i) => {
      if (s.state !== "unknown") return;
      const assetId = assetOf(s.nodeId);
      for (const m of s.mitigations) {
        const key = `${assetId}:${m}`;
        const cur = asked.get(key);
        if (!cur || cur.position > i)
          asked.set(key, { position: i, ...(s.labelJa ? { stageJa: s.labelJa } : {}) });
      }
    });
  }
  return asked;
}

/**
 * 未確認の緩和策を、答えると結論が変わりやすい順に並べる。
 * 経路に出ている未確認（入口に近い順）→ それ以外（カルテの順）。同じ位置なら カルテの順を保つ
 */
export function rankPending(
  profile: CompanyProfile,
  verdict: Verdict | undefined,
  graph: Graph | undefined,
): PendingItem[] {
  const asked = askedOnPath(verdict, graph);
  const items: PendingItem[] = [];
  for (const a of profile.assets) {
    for (const c of a.controls) {
      if (c.status !== "unknown") continue;
      const hit = asked.get(`${a.id}:${c.mitigation}`);
      items.push({
        assetId: a.id,
        assetLabel: a.label,
        mitigation: c.mitigation,
        onPath: hit !== undefined,
        ...(hit?.stageJa ? { stageJa: hit.stageJa } : {}),
        ...(hit ? { position: hit.position } : {}),
      });
    }
  }
  return items
    .map((it, i) => ({ it, i }))
    .sort((x, y) => {
      const px = x.it.position ?? Number.POSITIVE_INFINITY;
      const py = y.it.position ?? Number.POSITIVE_INFINITY;
      return px !== py ? px - py : x.i - y.i;
    })
    .map((x) => x.it);
}

/** 経路の段階のうち未確認のもの（結論が最悪の想定で出ているときの注記に使う）。AI の経路は除く */
export function unknownStepLabels(verdict: Verdict, graph: Graph): string[] {
  const label = (id: string) => graph.nodes.find((n) => n.id === id)?.label ?? id;
  const out: string[] = [];
  for (const p of verdict.paths) {
    if (p.source === "ai") continue;
    for (const s of p.steps) {
      if (s.state !== "unknown") continue;
      const l = label(s.nodeId);
      if (!out.includes(l)) out.push(l);
    }
  }
  return out;
}

export type TemplateRef = { id: string; labelJa: string };

/** 経路の型紙の名前（複数の型紙を展開したときの見出し用） */
export function pathTemplateLabel(path: AttackPath, templates: TemplateRef[]): string | undefined {
  if (!path.templateId) return undefined;
  return templates.find((t) => t.id === path.templateId)?.labelJa ?? path.templateId;
}

/**
 * 判定に使った型紙の見出し。
 * - 1 本に絞れた（verdict.templateLabelJa がある）：型紙「X」で判定
 * - 入口不明で複数を展開した（templateId が無く、経路ごとに templateId がある）：型紙「A」「B」で判定（…）
 * - どちらも無い：空
 */
export function templateHeading(verdict: Verdict, templates: TemplateRef[]): string {
  if (verdict.templateLabelJa) return `型紙「${verdict.templateLabelJa}」で判定`;
  const ids = [
    ...new Set(
      verdict.paths
        .filter((p) => p.source !== "ai" && p.templateId)
        .map((p) => p.templateId as string),
    ),
  ];
  if (ids.length === 0) return "";
  const names = ids.map((id) => templates.find((t) => t.id === id)?.labelJa ?? id);
  if (names.length === 1) return `型紙「${names[0]}」で判定`;
  return `型紙${names.map((n) => `「${n}」`).join("")}の ${names.length} 本で判定（入口が不明なので、当てはまる型紙を全部展開）`;
}
