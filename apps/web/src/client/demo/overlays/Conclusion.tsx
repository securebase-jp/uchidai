/**
 * 結論（場面 7）：2 秒の無音と暗転のあと、「うちの会社は、大丈夫ではありませんでした」が明朝体で大きく出て、
 * 4 つのタイルの数字（売上は 0 から数え上げる）が並ぶ。数字は判定結果（Verdict.impact）をそのまま写す。
 * 判定は AI ではなくルールと会社カルテで決めている（画面の隅の注記は storyboard の層）
 */
import { useApp } from "../../hooks/useApp.tsx";
import { impactTiles } from "../../lib/conclusion.ts";
import { yen } from "../../lib/labels.ts";
import { countUp } from "../layers.tsx";

/** 無音と暗転が終わる時刻（読み上げの先頭の無音と同じ） */
export const T_HEAD = 2.0;
const T_TILES = 3.4;
const COUNT_DUR = 2.4;

export function ConclusionOverlay({ elapsed }: { elapsed: number }) {
  const app = useApp();
  const v = app.evaluation?.verdict;
  if (!v) return <div className="demo-overlay conclusion" />;
  const tiles = impactTiles(v, yen);
  const revenue = v.impact.revenueImpactJpy ?? 0;
  const shown = (key: string, value: string) =>
    key === "revenue" && revenue > 0
      ? yen(countUp(revenue, elapsed, T_TILES + 0.4, COUNT_DUR)) || "0円"
      : value;
  return (
    <div className="demo-overlay conclusion" role="dialog" aria-label="結論">
      <h1 className={`concl-head${elapsed >= T_HEAD ? " in" : ""}`}>{v.headlineJa}</h1>
      <dl className="concl-tiles" aria-label="影響の目安">
        {tiles.map((t, i) => (
          <div
            key={t.key}
            className={`concl-tile ${t.hot ? "hot" : "none"}${elapsed >= T_TILES + i * 0.35 ? " in" : ""}`}
          >
            <dt>{t.label}</dt>
            <dd>
              <span className="concl-val">{shown(t.key, t.value)}</span>
              {t.sub && <span className="concl-sub">{t.sub}</span>}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
