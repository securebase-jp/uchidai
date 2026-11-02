/** 時間軸：Day0 からの出来事と、売上影響の積み上げ。対策で再判定すると出来事が消える */
import { AnimatePresence, motion } from "motion/react";
import { yen } from "../lib/labels.ts";
import type { TimelineView } from "../lib/timeline.ts";
import type { CompanyProfile, Verdict } from "../lib/types.ts";

type Props = {
  view: TimelineView;
  verdict: Verdict;
  profile: CompanyProfile;
  day: number;
  concluded: boolean;
  reduced: boolean;
};

const W = 1240;
const H = 200;
const X0 = 120;
const X1 = W - 40;
const AXIS_Y = 150;
const ROW_H = 24;
const CHAR_W = 12.5;

/** ラベルの重なりを避けて行を割り当てる（x の範囲が重なるものは上の行へ） */
function assignRows<T extends { x: number; width: number }>(items: T[]): (T & { row: number })[] {
  const lastEnd: number[] = [];
  return items.map((it) => {
    let row = 0;
    while ((lastEnd[row] ?? Number.NEGATIVE_INFINITY) > it.x - 10) row++;
    lastEnd[row] = it.x + it.width;
    return { ...it, row };
  });
}

export function TimelineBar({ view, verdict, profile, day, concluded, reduced }: Props) {
  const lastDay = Math.max(view.lastDay, verdict.impact.downtimeDays, 7);
  const x = (d: number) => X0 + ((X1 - X0) * Math.min(d, lastDay)) / lastDay;
  const ticks: number[] = [];
  const stepDays = lastDay <= 14 ? 1 : lastDay <= 30 ? 5 : 10;
  for (let d = 0; d <= lastDay; d += stepDays) ticks.push(d);
  const shown = concluded ? view.events : view.events.filter((e) => e.day <= day && e.day > 0);
  const visible = concluded || day > 0 ? shown.filter((e) => e.day <= lastDay) : [];
  const far = view.events.filter((e) => e.day > lastDay);
  const daily = profile.dailyRevenue ?? 0;
  const stopDays = Math.min(day, verdict.impact.downtimeDays);
  const money = stopDays * daily;
  const placed = assignRows(
    visible.map((e) => {
      const px = x(e.day);
      const width = e.labelJa.length * CHAR_W + 14;
      const flip = px + width > X1;
      return { e, x: flip ? px - width : px, px, width, flip };
    }),
  );
  return (
    <div className="timeline panel">
      <h2>
        時間軸（Day 0 から）
        {view.events.length === 0 && (
          <span className="chip" style={{ marginLeft: 8 }}>
            {verdict.result === "out_of_scope"
              ? "判定の対象外のため、業務への影響と期限は計算していません"
              : verdict.result === "no_entry"
                ? "この攻撃の入口が無いため、業務への影響と期限は発生しません"
                : "この経路では業務への影響と期限は発生しません"}
          </span>
        )}
      </h2>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Day 0 からの出来事と売上影響の時間軸">
        <line className="tl-axis" x1={X0} y1={AXIS_Y} x2={X1} y2={AXIS_Y} />
        {ticks.map((d) => (
          <g key={d}>
            <line className="tl-axis" x1={x(d)} y1={AXIS_Y - 4} x2={x(d)} y2={AXIS_Y + 4} />
            <text className="tl-tick" x={x(d)} y={AXIS_Y + 20} textAnchor="middle">
              {d === 0 ? "Day 0" : d}
            </text>
          </g>
        ))}
        {daily > 0 && money > 0 && (
          <>
            <rect
              className="tl-money"
              x={X0}
              y={AXIS_Y + 4}
              width={Math.max(0, x(stopDays) - X0)}
              height={8}
              rx={2}
            />
            <text
              className="tl-tick"
              x={x(stopDays) + 6}
              y={AXIS_Y + 12}
              style={{ fill: "var(--cash)", fontWeight: 700 }}
            >
              売上影響 {yen(money)}
            </text>
          </>
        )}
        {day > 0 && (
          <line
            className="tl-cursor glowf"
            x1={x(day)}
            y1={AXIS_Y - 14}
            x2={x(day)}
            y2={AXIS_Y + 6}
          />
        )}
        <AnimatePresence>
          {placed.map(({ e, x: lx, px, flip, row }, i) => {
            const y = AXIS_Y - 26 - row * ROW_H;
            return (
              <motion.g
                key={`${e.kind}-${e.day}-${e.labelJa}`}
                className={`tl-ev k-${e.kind}`}
                initial={reduced ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{ delay: reduced ? 0 : i * 0.08, duration: 0.3 }}
              >
                <title>{`Day ${e.day}　${e.labelJa}${e.detailJa ? `：${e.detailJa}` : ""}${e.sourceJa ? `（${e.sourceJa}）` : ""}`}</title>
                <line
                  className="lead"
                  x1={px}
                  y1={y + 4}
                  x2={px}
                  y2={AXIS_Y - 6}
                  stroke="currentColor"
                  style={{ color: "var(--ink-3)" }}
                />
                <circle
                  cx={px}
                  cy={AXIS_Y - 4}
                  r={4}
                  fill="currentColor"
                  style={{ color: "var(--ink-2)" }}
                />
                <text x={flip ? lx + 4 : lx + 6} y={y}>
                  {e.labelJa}
                </text>
              </motion.g>
            );
          })}
        </AnimatePresence>
        {concluded && far.length > 0 && (
          <text className="tl-tick" x={X1} y={AXIS_Y + 40} textAnchor="end">
            {far.map((e) => `Day ${e.day} ${e.labelJa}`).join("　")}
          </text>
        )}
      </svg>
    </div>
  );
}
