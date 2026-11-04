/**
 * 確認の進み具合の輪：確認済み N ／ 全 M。輪の色は根拠の内訳（外部確認、ベンダー回答、担当者登録）と未確認（黄）。
 * 色だけに頼らず、輪の横の凡例に根拠の名前と件数を出す。輪を押すと最初の未確認の項目へ移る
 */
import type { Progress } from "../lib/profile.ts";

export type RingSegment = {
  key: "external" | "vendor" | "registered" | "other" | "unknown";
  labelJa: string;
  color: string;
  count: number;
};

/** 輪に並べる順（確認済みの根拠が先、未確認が最後） */
export function ringSegments(p: Progress): RingSegment[] {
  return [
    { key: "external", labelJa: "外部確認", color: "var(--green)", count: p.external },
    { key: "vendor", labelJa: "ベンダー回答", color: "var(--steel)", count: p.vendor },
    { key: "registered", labelJa: "担当者登録", color: "var(--violet)", count: p.registered },
    { key: "other", labelJa: "根拠なし", color: "var(--ink-3)", count: p.other },
    { key: "unknown", labelJa: "未確認", color: "var(--amber)", count: p.unknown },
  ];
}

const SIZE = 72;
const R = 28;
const C = 2 * Math.PI * R;

export function ProgressRing({ progress, onJump }: { progress: Progress; onJump(): void }) {
  const confirmed = progress.total - progress.unknown;
  const segs = ringSegments(progress);
  let offset = 0;
  const arcs = segs
    .filter((s) => s.count > 0 && progress.total > 0)
    .map((s) => {
      const len = (s.count / progress.total) * C;
      const arc = (
        <circle
          key={s.key}
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          fill="none"
          stroke={s.color}
          strokeWidth={9}
          strokeDasharray={`${len} ${C - len}`}
          strokeDashoffset={-offset}
          transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
        />
      );
      offset += len;
      return arc;
    });
  const pending = progress.unknown > 0;
  return (
    <div className="progress">
      <button
        type="button"
        className={`count ring-btn ${pending ? "amber" : "green"}`}
        onClick={onJump}
        disabled={!pending}
        title={pending ? "最初の未確認の項目へ移ります" : undefined}
        aria-label={`確認の進み具合：全 ${progress.total} 件のうち ${confirmed} 件が確認済み、未確認 ${progress.unknown} 件${pending ? "。押すと最初の未確認の項目へ移ります" : ""}`}
      >
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            fill="none"
            stroke="var(--edge)"
            strokeWidth={9}
          />
          {arcs}
          <text x={SIZE / 2} y={SIZE / 2 - 1} className="ring-n" textAnchor="middle">
            {confirmed}
          </text>
          <text x={SIZE / 2} y={SIZE / 2 + 13} className="ring-m" textAnchor="middle">
            / {progress.total}
          </text>
        </svg>
        <span className="ring-cap">未確認 {progress.unknown} 件</span>
      </button>
      <ul className="ring-legend" aria-label="確認済みの根拠の内訳">
        {segs
          .filter((s) => s.key !== "unknown" && (s.count > 0 || s.key !== "other"))
          .map((s) => (
            <li key={s.key}>
              <i className="dot" style={{ background: s.color }} aria-hidden="true" />
              {s.labelJa}
              <b>{s.count}</b>
            </li>
          ))}
      </ul>
    </div>
  );
}
