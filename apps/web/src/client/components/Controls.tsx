/** 再生の操作：再生／一時停止、結論まで進める、もう一度、速さ、動きを減らす。構成図の直上に置き、図が見えている間は上に追従する */
import type { ReactNode } from "react";
import type { Clock } from "../hooks/useClock.ts";

type Props = {
  clock: Clock;
  reduced: boolean;
  onReduced(v: boolean): void;
  /** 図の見方（凡例）の情報ボタンなど、右端に置くもの */
  extra?: ReactNode;
  /** 構成図が見えている間、画面の上に追従する */
  sticky?: boolean;
};

export function Controls({ clock, reduced, onReduced, extra, sticky = false }: Props) {
  return (
    <div className={`controls${sticky ? " sticky" : ""}`}>
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
      <label className="group lab" style={{ cursor: "pointer" }}>
        <input type="checkbox" checked={reduced} onChange={(e) => onReduced(e.target.checked)} />
        動きを減らす（結論だけを表示）
      </label>
      {extra && <span className="controls-extra">{extra}</span>}
    </div>
  );
}
