/**
 * 経路図（SVG）。ノードは自社の実際の構成要素、線はエッジに沿う。
 * 色だけでなく語（止まる／復旧できる／未確認／人次第／突破される）でも状態を示す。
 */
import { useMemo } from "react";
import { curveBetween } from "../lib/geometry.ts";
import { wrapLabel } from "../lib/labels.ts";
import type { Layout, Placed } from "../lib/layout.ts";
import type { Scene, Script } from "../lib/playback.ts";
import type { CompanyProfile, Graph, GraphNode, Layer } from "../lib/types.ts";

const LAYER_TITLE: Record<Layer, [string, string]> = {
  system: ["システム", "会社の IT と、人"],
  business: ["業務", "現場と仕事"],
  management: ["経営", "影響・お金・義務"],
};

export type DiagramProps = {
  layout: Layout;
  graph: Graph;
  scene?: Scene;
  script?: Script;
  profile?: CompanyProfile;
  showIds?: boolean;
  /** 5問の画面で、まだ現れていないノード */
  hidden?: Set<string>;
  /** 新しく現れたノード（出現の演出） */
  appearing?: Set<string>;
  measureLabel?: (mitigation: string) => string;
};

function GridLines({ layout }: { layout: Layout }) {
  return (
    <g>
      {layout.planes.map((p) => {
        const lines = [];
        for (let i = 1; i < 14; i++) {
          const u = i / 14;
          lines.push(
            <line
              key={`v${p.layer}${i}`}
              className="plane-grid"
              x1={p.topL + (p.topR - p.topL) * u}
              y1={p.top}
              x2={p.botL + (p.botR - p.botL) * u}
              y2={p.bottom}
            />,
          );
        }
        const rows = Math.floor((p.bottom - p.top) / 24);
        for (let i = 1; i < rows; i++) {
          const v = i / rows;
          const y = p.top + (p.bottom - p.top) * v;
          lines.push(
            <line
              key={`h${p.layer}${i}`}
              className="plane-grid"
              x1={p.topL + (p.botL - p.topL) * v}
              y1={y}
              x2={p.topR + (p.botR - p.topR) * v}
              y2={y}
            />,
          );
        }
        return <g key={p.layer}>{lines}</g>;
      })}
    </g>
  );
}

function Shield({ p, ng, label }: { p: Placed; ng: boolean; label: string }) {
  const x = p.x - p.w / 2 - 16;
  const y = p.y;
  const d = `M${x} ${y - 14} l12 4 v10 c0 8 -5 13 -12 16 c-7 -3 -12 -8 -12 -16 v-10 z`;
  return (
    <g className="glowf">
      <path className={`shield${ng ? " ng" : ""}`} d={d} />
      <text className={`shield-label${ng ? " ng" : ""}`} x={x} y={y + 30} textAnchor="middle">
        {ng ? "効かない" : "効く"}
      </text>
      <text className="shield-label" x={x - 16} y={y + 4} textAnchor="end">
        {label}
      </text>
    </g>
  );
}

/** 箱の中の文字の縦位置（箱の上端からの基線）。2 行＋状態の行のときは状態を下端に寄せる */
function textRows(
  count: number,
  hasTag: boolean,
  h: number,
  sm: boolean,
): { lines: number[]; tag?: number; tagTight: boolean } {
  const fs = sm ? 13 : 15;
  const pitch = fs + 2;
  const baseline = (center: number) => center + fs * 0.38;
  const spread = (mid: number) =>
    Array.from({ length: count }, (_, i) => baseline(mid + (i - (count - 1) / 2) * pitch));
  if (!hasTag) return { lines: spread(h / 2), tagTight: false };
  if (count === 1) return { lines: [h / 2 - 3], tag: h / 2 + 15, tagTight: false };
  const tagTight = h < 48;
  const bottom = h - (tagTight ? 10 : 12) - 4;
  return { lines: spread((2 + bottom) / 2), tag: h - 4, tagTight };
}

function Node({
  n,
  p,
  scene,
  profile,
  showIds,
  appearing,
  measureLabel,
}: {
  n: GraphNode;
  p: Placed;
  scene?: Scene;
  profile?: CompanyProfile;
  showIds: boolean;
  appearing: boolean;
  measureLabel: (m: string) => string;
}) {
  const v = scene?.nodes[n.id];
  const tone = v?.tone;
  const tag = v?.tagJa;
  const asset = n.assetId ? profile?.assets.find((a) => a.id === n.assetId) : undefined;
  const estimated = asset ? Object.values(asset.attrEvidence).includes("external") : false;
  const x0 = p.x - p.w / 2;
  const y0 = p.y - p.h / 2;
  const perLine = n.layer === "management" ? 12 : n.layer === "business" ? 8 : 7;
  const lines = wrapLabel(n.label, perLine);
  const longest = Math.max(...lines.map((l) => l.length));
  const sm = longest > 7 || longest * 15 > p.w - 12 || (lines.length > 1 && !!tag && p.h < 58);
  const rows = textRows(lines.length, !!tag, p.h, sm);
  const cls = [
    "node",
    n.role === "attacker" ? "attacker" : "",
    tone ? `tone-${tone}` : "",
    v?.hitAt !== undefined ? "hit" : "",
    appearing ? "appear" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const blocked = scene?.walls.includes(n.id);
  return (
    <g className={cls} key={`${n.id}-${v?.hitAt ?? "idle"}`} data-node={n.id}>
      <title>{`${n.label}${tag ? `：${tag}` : ""}`}</title>
      <rect className="box" x={x0} y={y0} width={p.w} height={p.h} rx={10} />
      <rect
        className={`fill${v?.hitAt !== undefined ? " spread" : ""}`}
        x={x0}
        y={y0}
        width={p.w}
        height={p.h}
        rx={10}
      />
      <rect className="glow glowf" x={x0} y={y0} width={p.w} height={p.h} rx={10} />
      <text className={`label${sm ? " sm" : ""}`} x={p.x} textAnchor="middle">
        {lines.map((line, i) => (
          <tspan key={line} x={p.x} y={y0 + (rows.lines[i] ?? 0)}>
            {line}
          </tspan>
        ))}
      </text>
      {tag && rows.tag !== undefined && (
        <text
          className={`tag${rows.tagTight ? " tight" : ""}`}
          x={p.x}
          y={y0 + rows.tag}
          textAnchor="middle"
        >
          {tag}
        </text>
      )}
      {showIds && v?.technique && p.rows <= 3 && (
        <text className="tid" x={x0 + p.w} y={y0 - 5} textAnchor="end">
          {v.technique}
        </text>
      )}
      {showIds && v?.technique && p.rows > 3 && (
        // 行が多い列は箱の上に余白が無いので、右下の角にまたがせる
        <text className="tid" x={x0 + p.w} y={y0 + p.h - 3} textAnchor="middle">
          {v.technique}
        </text>
      )}
      {estimated && p.rows <= 3 && (
        <g>
          <rect className="est-box" x={x0} y={y0 - 16} width={66} height={14} rx={7} />
          <text className="est" x={x0 + 33} y={y0 - 5.5} textAnchor="middle">
            外部から推定
          </text>
        </g>
      )}
      {estimated && p.rows > 3 && (
        // 行が多い列は箱の上に余白が無いので、右端にまたがる小さな札にする
        <g>
          <title>外部から推定</title>
          <rect className="est-box" x={x0 + p.w - 14} y={p.y - 7} width={28} height={14} rx={7} />
          <text className="est" x={x0 + p.w} y={p.y + 3.5} textAnchor="middle">
            推定
          </text>
        </g>
      )}
      {v && v.ineffective.length > 0 && (
        <Shield p={p} ng label={measureLabel(v.ineffective[0]?.mitigation ?? "")} />
      )}
      {v && v.ineffective.length === 0 && v.effective.length > 0 && (
        <Shield p={p} ng={false} label={measureLabel(v.effective[0] ?? "")} />
      )}
      {blocked && (
        <g className="glowf">
          <rect className="wall" x={x0 - 11} y={y0 - 6} width={6} height={p.h + 12} rx={3} />
          <circle className="ripple" cx={x0 - 8} cy={p.y} r={6} />
          <circle className="ripple d2" cx={x0 - 8} cy={p.y} r={6} />
        </g>
      )}
    </g>
  );
}

export function Diagram({
  layout,
  graph,
  scene,
  script,
  profile,
  showIds = false,
  hidden,
  appearing,
  measureLabel,
}: DiagramProps) {
  const ml = measureLabel ?? ((m: string) => m);
  const segs = useMemo(() => {
    if (!script) return [];
    const seen = new Set<string>();
    return script.segments.filter((s) => {
      if (seen.has(s.edgeId)) return false;
      seen.add(s.edgeId);
      return true;
    });
  }, [script]);
  const curvedEdges = useMemo(() => {
    const set = new Set<string>();
    for (const b of script?.beats ?? []) if (b.kind === "traverse" && b.curved) set.add(b.edgeId);
    return set;
  }, [script]);
  const isHidden = (id: string) => hidden?.has(id) ?? false;
  const nodes = graph.nodes.filter((n) => layout.nodes[n.id] && !isHidden(n.id));
  const planeSub = (layer: Layer) => LAYER_TITLE[layer];

  return (
    <svg
      className="diagram"
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      role="img"
      aria-label="自社の構成の上を攻撃が進む経路図。システム、業務、経営の三層"
    >
      <defs>
        <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {layout.planes.map((p) => (
        <polygon key={p.layer} className="plane" points={p.points} />
      ))}
      <GridLines layout={layout} />
      {layout.planes.map((p) => {
        const f = scene?.flashes.find((x) => x.layer === p.layer);
        return (
          <polygon
            key={`${p.layer}-${f?.at ?? "n"}`}
            className={`plane-flash${f ? " go" : ""}`}
            points={p.points}
          />
        );
      })}
      {layout.planes.map((p) =>
        // 面の左上に重ねる。背の高いシステムの面は 2 行、低い業務・経営の面は 1 行
        p.layer === "system" ? (
          <g key={`${p.layer}-t`}>
            <text className="layer-label" x={p.topL + 14} y={p.top + 25}>
              {planeSub(p.layer)[0]}
            </text>
            <text className="layer-sub" x={p.topL + 14} y={p.top + 43}>
              {planeSub(p.layer)[1]}
            </text>
          </g>
        ) : (
          <text key={`${p.layer}-t`} className="layer-label" x={p.topL + 14} y={p.top + 25}>
            {planeSub(p.layer)[0]}
            <tspan className="layer-sub" dx={10}>
              {planeSub(p.layer)[1]}
            </tspan>
          </text>
        ),
      )}
      {layout.dividers.map((d, i) => {
        const p = layout.planes.find((x) => x.layer === d.layer);
        if (!p) return null;
        const x1 = p.topL + (p.topR - p.topL) * d.u;
        const x2 = p.botL + (p.botR - p.botL) * d.u;
        return (
          <g key={`${d.layer}${d.u}`}>
            <line className="divider" x1={x1} y1={p.top + 4} x2={x2} y2={p.bottom - 4} />
            <text className="divider-label" x={x1 + 6} y={p.top + 16}>
              {d.labelJa}
            </text>
            {i === 0 && (
              <text className="divider-label" x={x1 - 6} y={p.top + 16} textAnchor="end">
                社外
              </text>
            )}
          </g>
        );
      })}
      <g>
        {layout.edges
          .filter((e) => !isHidden(e.from) && !isHidden(e.to))
          .map((e) => {
            const st = scene?.edges[e.id];
            return (
              <line
                key={e.id}
                className={`wire ${e.kind}${st === "dead" ? " dead" : ""}`}
                x1={e.x1}
                y1={e.y1}
                x2={e.x2}
                y2={e.y2}
              />
            );
          })}
      </g>
      <g className="glowf">
        {segs.map((s) => {
          const a = layout.nodes[s.from];
          const b = layout.nodes[s.to];
          if (!a || !b || isHidden(s.from) || isHidden(s.to)) return null;
          const c = curveBetween(a, b, curvedEdges.has(s.edgeId));
          const st = scene?.edges[s.edgeId];
          const cls = [
            "seg",
            s.source,
            st === "attack" || st === "fallen" || st === "blocked" ? st : "",
            s.branch ? "branch" : "",
          ]
            .filter(Boolean)
            .join(" ");
          return <path key={s.edgeId} className={cls} d={c.d} />;
        })}
      </g>
      <g>
        {nodes.map((n) => {
          const p = layout.nodes[n.id];
          if (!p) return null;
          return (
            <Node
              key={n.id}
              n={n}
              p={p}
              {...(scene ? { scene } : {})}
              {...(profile ? { profile } : {})}
              showIds={showIds}
              appearing={appearing?.has(n.id) ?? false}
              measureLabel={ml}
            />
          );
        })}
      </g>
    </svg>
  );
}
