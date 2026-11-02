/** 再生の操作：再生／一時停止、結論まで進める、もう一度、動きを減らす */
import type { Clock } from "../hooks/useClock.ts";

type Props = {
  clock: Clock;
  reduced: boolean;
  onReduced(v: boolean): void;
  speedOptions?: boolean;
};

export function Controls({ clock, reduced, onReduced, speedOptions = true }: Props) {
  return (
    <div className="controls">
      <div className="group">
        <button
          type="button"
          className="btn primary"
          onClick={clock.ended ? clock.restart : clock.toggle}
          disabled={reduced}
        >
          {clock.ended ? "もう一度" : clock.playing ? "一時停止" : "再生する"}
        </button>
        <button type="button" className="btn" onClick={clock.toEnd} disabled={clock.ended}>
          結論まで進める
        </button>
        {!clock.ended && (
          <button type="button" className="btn ghost sm" onClick={clock.restart} disabled={reduced}>
            最初から
          </button>
        )}
      </div>
      {speedOptions && (
        <fieldset className="group" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="lab" style={{ float: "left", marginRight: 6 }}>
            速さ
          </legend>
          {[0.5, 1, 2].map((v) => (
            <button
              type="button"
              key={v}
              className="btn sm"
              aria-pressed={clock.speed === v}
              onClick={() => clock.setSpeed(v)}
            >
              ×{v}
            </button>
          ))}
        </fieldset>
      )}
      <label className="group lab" style={{ cursor: "pointer" }}>
        <input type="checkbox" checked={reduced} onChange={(e) => onReduced(e.target.checked)} />
        動きを減らす（結論だけを表示）
      </label>
    </div>
  );
}
