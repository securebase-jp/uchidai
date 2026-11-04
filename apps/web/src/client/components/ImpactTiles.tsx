/** 結論カードの数字タイル：停止日数・売上影響・取引先に出る日・報告義務を、文の代わりに数字で見せる */
import { type ImpactTile, impactTiles } from "../lib/conclusion.ts";
import { yen } from "../lib/labels.ts";
import type { Verdict } from "../lib/types.ts";
import { SourceRef } from "./SourceRef.tsx";

export function ImpactTiles({ verdict }: { verdict: Verdict }) {
  const tiles = impactTiles(verdict, yen);
  if (tiles.length === 0) return null;
  return (
    <dl className="vt-tiles" aria-label="影響の目安">
      {tiles.map((t) => (
        <Tile key={t.key} tile={t} />
      ))}
    </dl>
  );
}

function Tile({ tile }: { tile: ImpactTile }) {
  return (
    <div className={`vt-tile ${tile.hot ? "hot" : "none"}`}>
      <dt>
        {tile.label}
        {tile.key === "report" && tile.hot && (
          <SourceRef
            id="ppc-guidelines"
            n={1}
            titleJa="個人情報保護委員会「ガイドライン（通則編）」"
          />
        )}
      </dt>
      <dd>
        <span className="vt-val">{tile.value}</span>
        {tile.sub && <span className="vt-sub">{tile.sub}</span>}
      </dd>
    </div>
  );
}
