/**
 * 期限の図：Day 0 から最大日数までの横の時間軸に、出来事の点と種類のアイコン、短い語を置く（社長向けの一枚）。
 * 紙（白地）と PDF でも読めるよう、色は紙の中の変数（onepager.css）だけを使う。値は engine が決めた期限そのまま
 */
import { iconOf } from "../components/timeline-icons.ts";
import { eventSourceId, shortLabel } from "../lib/timeline-view.ts";
import type { OnePagerDeadline } from "../lib/types.ts";
import { AX, groupByDayKind, layoutDeadlineAxis } from "./deadline-axis.ts";
import { type SourceNumbers, sourceTitle } from "./source-numbers.ts";

type Props = { deadlines: OnePagerDeadline[]; numbers: SourceNumbers };

export function DeadlineAxis({ deadlines, numbers }: Props) {
  const groups = groupByDayKind(deadlines);
  const labelOf = (g: OnePagerDeadline[]) => [...new Set(g.map(shortLabel))].join("・");
  const inputs = groups.map((g) => ({
    day: g[0]?.day ?? 0,
    label: labelOf(g),
    hasSource: g.some((d) => eventSourceId(d) !== undefined),
  }));
  const L = layoutDeadlineAxis(inputs);
  const ICON = AX.ICON;
  return (
    <figure className="op-axis" aria-label="期限の時間軸">
      <svg viewBox={`0 0 ${AX.W} ${L.height}`} className="op-axis-svg">
        <title>起きた日（0 日目）から最大 {L.maxDay} 日目までの、届け出と連絡の期限</title>
        <line className="op-ax-line" x1={AX.X0} y1={L.axisY} x2={AX.X1} y2={L.axisY} />
        {L.ticks.map((t) => (
          <g key={t.day}>
            <line className="op-ax-line" x1={t.x} y1={L.axisY - 3} x2={t.x} y2={L.axisY + 4} />
            <text className="op-ax-tick" x={t.x} y={L.axisY + 18} textAnchor="middle">
              {t.day}
            </text>
          </g>
        ))}
        <text className="op-ax-tick" x={AX.X1 + 8} y={L.axisY + 18}>
          日目
        </text>
        {/* 引き出し線と点を先に描き、ラベルを後から重ねる（線が文字を横切らないように） */}
        {L.items.map((it) => {
          const g = groups[it.index] as OnePagerDeadline[];
          const d = g[0] as OnePagerDeadline;
          const cy = L.axisY - 12 - it.row * AX.ROW_H - 4;
          return (
            <g key={`lead-${d.day}-${d.labelJa}`} className={`op-ax-ev k-${d.kind}`}>
              <line
                className="op-ax-lead"
                x1={it.px}
                y1={cy + AX.ICON / 2}
                x2={it.px}
                y2={L.axisY - 4}
              />
              <circle className="op-ax-dot" cx={it.px} cy={L.axisY} r={3.5} />
            </g>
          );
        })}
        {L.items.map((it) => {
          const g = groups[it.index] as OnePagerDeadline[];
          const d = g[0] as OnePagerDeadline;
          const Icon = iconOf(d.kind);
          const src = g.map(eventSourceId).find((x) => x !== undefined);
          const n = numbers.n(src);
          const short = labelOf(g);
          const cy = L.axisY - 12 - it.row * AX.ROW_H - 4;
          const textX = it.flip ? it.px - 10 - (src ? 10 : 0) : it.px + 10;
          const textEnd = it.px + 10 + short.length * AX.CHAR_W;
          return (
            <g key={`${d.day}-${d.labelJa}`} className={`op-ax-ev k-${d.kind}`}>
              <title>{`${d.day} 日目　${g.map((x) => x.labelJa).join("、")}`}</title>
              <Icon
                className="op-ax-ic"
                x={it.px - ICON / 2}
                y={cy - ICON / 2}
                width={ICON}
                height={ICON}
                strokeWidth={2.2}
                aria-hidden="true"
              />
              <text
                className="op-ax-label"
                x={textX}
                y={cy + 4}
                textAnchor={it.flip ? "end" : "start"}
              >
                {short}
              </text>
              {src && n && (
                <a
                  href={`#/sources?src=${encodeURIComponent(src)}`}
                  aria-label={`出典 ${n}：${sourceTitle(src)}`}
                >
                  <text
                    className="op-ax-src"
                    x={it.flip ? textX + 2 : textEnd + 2}
                    y={cy - 3}
                    textAnchor="start"
                  >
                    {n}
                  </text>
                </a>
              )}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}
