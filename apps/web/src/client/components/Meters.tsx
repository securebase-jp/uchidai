/** 計器（等幅）：経過日数、停止日数、売上影響。時計を購読して連動する */
import { useEffect, useState } from "react";
import type { Clock } from "../hooks/useClock.ts";
import { yen } from "../lib/labels.ts";
import type { Scene } from "../lib/playback.ts";
import type { CompanyProfile, Verdict } from "../lib/types.ts";

type Props = {
  clock: Clock;
  scene: Scene;
  verdict: Verdict;
  profile: CompanyProfile;
  /** 赤の結論に達したら、すべての数字を赤にする（社長画面の警告） */
  alert?: boolean;
};

export function useDayCounter(clock: Clock, scene: Scene): number {
  const [day, setDay] = useState(0);
  useEffect(() => {
    const beat = scene.daysBeat;
    return clock.subscribe((now) => {
      let d = 0;
      if (beat) d = Math.round(Math.min(1, Math.max(0, (now - beat.t) / beat.dur)) * beat.to);
      setDay((prev) => (prev === d ? prev : d));
    });
  }, [clock, scene.daysBeat]);
  return day;
}

export function Meters({ clock, scene, verdict, profile, alert = false }: Props) {
  const day = useDayCounter(clock, scene);
  const downtime = Math.min(day, verdict.impact.downtimeDays);
  // 止まる業務が無い結論（情報漏えいなど）は、「0日」「0円」でなく「なし」と出し、売上影響の計器は出さない
  const stops = verdict.impact.downtimeDays > 0;
  const revenue =
    stops && profile.dailyRevenue !== undefined ? profile.dailyRevenue * downtime : undefined;
  const alarm = alert && scene.concluded && verdict.result === "breached";
  const hot = alarm ? "hot" : downtime > 0 ? (verdict.result === "mitigated" ? "warm" : "hot") : "";
  const money = verdict.impact.moneyLossJpy;
  return (
    <div className="meters" aria-live="off">
      <div className={`meter ${day > 0 || alarm ? hot : ""}`}>
        <div className="k">経過</div>
        <div className="v">Day {day}</div>
      </div>
      <div className={`meter ${hot}`}>
        <div className="k">業務停止</div>
        <div className="v">{stops ? `${downtime}日` : "なし"}</div>
      </div>
      {revenue !== undefined && (
        <div className={`meter ${hot}`}>
          <div className="k">売上影響の目安</div>
          <div className="v">{yen(revenue)}</div>
        </div>
      )}
      {money !== undefined && money > 0 && (
        <div className={`meter ${scene.concluded ? "hot" : ""}`}>
          <div className="k">資金の流出</div>
          <div className="v">{scene.concluded ? yen(money) : "0円"}</div>
        </div>
      )}
    </div>
  );
}
