/** 時間軸：Day0 からの出来事と、売上影響の積み上げ。対策で再判定すると出来事が消える */
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { yen } from "../lib/labels.ts";
import { STAFF_SOURCES } from "../lib/staff-sources.ts";
import type { TimelineView } from "../lib/timeline.ts";
import { eventSourceId, shortLabel } from "../lib/timeline-view.ts";
import type { CompanyProfile, TimelineEvent, Verdict } from "../lib/types.ts";
import { InfoButton } from "./InfoButton.tsx";
import { StaffSourceRef } from "./StaffSourceRef.tsx";
import { iconOf } from "./timeline-icons.ts";

type Props = {
  view: TimelineView;
  verdict: Verdict;
  profile: CompanyProfile;
  day: number;
  concluded: boolean;
  reduced: boolean;
};

const W = 900;
const X0 = 56;
const X1 = W - 40;
const ROW_H = 24;
const CHAR_W = 13.5;
const ICON = 16;
const eventKey = (e: TimelineEvent) => `${e.kind}-${e.day}-${e.labelJa}`;

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
  const [pickedKey, setPickedKey] = useState<string | undefined>();
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
      const width = ICON + 6 + shortLabel(e).length * CHAR_W + 14;
      const flip = px + width > X1;
      return { e, x: flip ? px - width : px, px, width, flip };
    }),
  );
  // 出来事の行が増えたら、軸を下げて上の行が切れないようにする
  const rows = Math.max(3, ...placed.map((p) => p.row + 1));
  const AXIS_Y = 38 + rows * ROW_H;
  const H = AXIS_Y + 50;
  const picked = visible.find((e) => eventKey(e) === pickedKey);
  const pickedSrc = picked ? eventSourceId(picked) : undefined;
  return (
    <div className="timeline panel">
      <h2>
        時間軸（Day 0 から）
        <InfoButton title="時間軸の読み方">
          <p>
            攻撃が来た日を Day 0
            として、業務が止まる日、取引先に影響が出る日、個人情報保護委員会への報告や
            保険の連絡の期限、復旧の見込みを並べます。日数と期限は knowledge/deadlines.yaml
            などの固定データから、プログラムが決定的に計算しています。
          </p>
          <p>
            下の緑の帯は、止まった日数に 1
            日の売上を掛けた売上影響の積み上げです。対策を入れて判定が変わると、
            起きなくなった出来事はこの軸から消えます。出来事に触れると詳しい内容と出典が出ます。
          </p>
        </InfoButton>
        {view.events.length === 0 && (
          <span className="chip" style={{ marginLeft: 8 }}>
            {verdict.result === "out_of_scope"
              ? "判定の対象外のため、業務への影響と期限は計算していません"
              : verdict.coverageGapJa
                ? "カルテに入口になる資産が無く、業務への影響と期限は計算していません"
                : verdict.result === "no_entry"
                  ? "この攻撃の入口が無いため、業務への影響と期限は発生しません"
                  : "この経路では業務への影響と期限は発生しません"}
          </span>
        )}
      </h2>
      <div className="tl-scroll">
        <svg viewBox={`0 0 ${W} ${H}`}>
          <title>Day 0 からの出来事と売上影響の時間軸</title>
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
            {placed.map(({ e, x: lx, px, row }, i) => {
              const y = AXIS_Y - 26 - row * ROW_H;
              const Icon = iconOf(e.kind);
              const key = eventKey(e);
              const src = eventSourceId(e);
              const short = shortLabel(e);
              const on = key === pickedKey;
              return (
                <motion.g
                  key={key}
                  className={`tl-ev k-${e.kind}${on ? " picked" : ""}`}
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
                  {/* SVG には button 要素が無いので、押せる出来事は role="button" の g にする（キーボードでも開ける） */}
                  {/* biome-ignore lint/a11y/useSemanticElements: SVG の中では button 要素を使えない */}
                  <g
                    className="tl-hit"
                    role="button"
                    tabIndex={0}
                    aria-pressed={on}
                    aria-label={`Day ${e.day}　${e.labelJa}。詳しく見る`}
                    onClick={() => setPickedKey(on ? undefined : key)}
                    onKeyDown={(ev) => {
                      if (ev.key === "Enter" || ev.key === " ") {
                        ev.preventDefault();
                        setPickedKey(on ? undefined : key);
                      }
                    }}
                  >
                    <rect
                      className="tl-hit-box"
                      x={lx - 2}
                      y={y - 15}
                      width={ICON + 6 + short.length * CHAR_W + (src ? 14 : 6)}
                      height={22}
                      rx={5}
                    />
                    <Icon
                      className="tl-ic"
                      x={lx}
                      y={y - 13}
                      width={ICON}
                      height={ICON}
                      strokeWidth={2.2}
                      aria-hidden="true"
                    />
                    <text x={lx + ICON + 6} y={y}>
                      {short}
                    </text>
                  </g>
                  {src && (
                    <a
                      href={`#/sources?src=${encodeURIComponent(src)}`}
                      aria-label={`出典 ${STAFF_SOURCES[src].n}：${STAFF_SOURCES[src].titleJa}`}
                    >
                      <title>{`出典：${STAFF_SOURCES[src].titleJa}`}</title>
                      <text
                        className="tl-src"
                        x={lx + ICON + 6 + short.length * CHAR_W + 2}
                        y={y - 6}
                      >
                        {STAFF_SOURCES[src].n}
                      </text>
                    </a>
                  )}
                </motion.g>
              );
            })}
          </AnimatePresence>
          {concluded && far.length > 0 && (
            <text className="tl-tick" x={X1} y={AXIS_Y + 40} textAnchor="end">
              {far.map((e) => `Day ${e.day} ${shortLabel(e)}`).join("　")}
            </text>
          )}
        </svg>
      </div>
      {picked && (
        <div className={`tl-detail k-${picked.kind}`} aria-live="polite">
          <b className="tl-detail-day">Day {picked.day}</b>
          <span>{picked.labelJa}</span>
          {picked.detailJa && <p>{picked.detailJa}</p>}
          {(picked.sourceJa || pickedSrc) && (
            <p className="tl-detail-src">
              出典：{picked.sourceJa}
              {pickedSrc && <StaffSourceRef id={pickedSrc} />}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
