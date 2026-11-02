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
const H = 150;
const X0 = 120;
const X1 = W - 40;

export function TimelineBar({ view, verdict, profile, day, concluded, reduced }: Props) {
  const lastDay = Math.max(view.lastDay, verdict.impact.downtimeDays, 7);
  const x = (d: number) => X0 + ((X1 - X0) * Math.min(d, lastDay)) / lastDay;
  const ticks: number[] = [];
  const stepDays = lastDay <= 14 ? 1 : lastDay <= 30 ? 5 : 10;
  for (let d = 0; d <= lastDay; d += stepDays) ticks.push(d);
  const shown = concluded ? view.events : view.events.filter((e) => e.day <= day && e.day > 0);
  const visible = concluded || day > 0 ? shown : [];
  const far = view.events.filter((e) => e.day > lastDay);
  const daily = profile.dailyRevenue ?? 0;
  const money = Math.min(day, verdict.impact.downtimeDays) * daily;
  // 同じ日のラベルの重なりを避ける
  const rows = new Map<number, number>();
  return (
    <div className="timeline panel">
      <h2>
        時間軸（Day 0 から）
        {view.provisional && (
          <span className="chip" style={{ marginLeft: 8 }}>
            仮の時間軸：経営の層（S4）が確定するまでの目安
          </span>
        )}
      </h2>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Day 0 からの出来事と売上影響の時間軸">
        <line className="tl-axis" x1={X0} y1={100} x2={X1} y2={100} />
        {ticks.map((d) => (
          <g key={d}>
            <line className="tl-axis" x1={x(d)} y1={96} x2={x(d)} y2={104} />
            <text className="tl-tick" x={x(d)} y={120} textAnchor="middle">
              {d === 0 ? "Day 0" : d}
            </text>
          </g>
        ))}
        {daily > 0 && money > 0 && (
          <rect
            className="tl-money"
            x={X0}
            y={104}
            width={Math.max(0, x(Math.min(day, verdict.impact.downtimeDays)) - X0)}
            height={8}
            rx={2}
          />
        )}
        {daily > 0 && money > 0 && (
          <text
            className="tl-tick"
            x={x(Math.min(day, verdict.impact.downtimeDays)) + 6}
            y={112}
            style={{ fill: "var(--cash)", fontWeight: 700 }}
          >
            {yen(money)}
          </text>
        )}
        {day > 0 && <line className="tl-cursor glowf" x1={x(day)} y1={84} x2={x(day)} y2={106} />}
        <AnimatePresence>
          {visible.map((e, i) => {
            const slot = rows.get(e.day) ?? 0;
            rows.set(e.day, slot + 1);
            const cx = x(e.day);
            const y = 78 - slot * 22;
            const anchor = cx > X1 - 160 ? "end" : "start";
            return (
              <motion.g
                key={`${e.kind}-${e.day}-${e.labelJa}`}
                className={`tl-ev k-${e.kind}`}
                initial={reduced ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{ delay: reduced ? 0 : i * 0.08, duration: 0.3 }}
              >
                <line
                  className="lead"
                  x1={cx}
                  y1={y + 4}
                  x2={cx}
                  y2={96}
                  stroke="currentColor"
                  style={{ color: "var(--ink-3)" }}
                />
                <circle
                  cx={cx}
                  cy={96}
                  r={4}
                  fill="currentColor"
                  style={{ color: "var(--ink-2)" }}
                />
                <text x={cx + (anchor === "end" ? -6 : 6)} y={y} textAnchor={anchor}>
                  {e.labelJa}
                  {e.detailJa ? `（${e.detailJa}）` : ""}
                </text>
              </motion.g>
            );
          })}
        </AnimatePresence>
        {concluded && far.length > 0 && (
          <text className="tl-tick" x={X1} y={140} textAnchor="end">
            {far.map((e) => `Day ${e.day} ${e.labelJa}`).join("　")}
          </text>
        )}
      </svg>
    </div>
  );
}
