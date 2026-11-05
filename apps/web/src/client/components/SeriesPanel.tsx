/**
 * 同じ事故の複数の報を読んだときの、報の間の差分（TRIAL-I-012）。
 * 段階ごとの確度を報の順に並べ、前の報から言い方が変わったセルを印で示す。比較はサーバ（engine）がプログラムで行ったもの
 */
import type { SeriesInfo } from "../../shared/api.ts";
import { InfoButton } from "./InfoButton.tsx";

type Props = { series: SeriesInfo };

export function SeriesPanel({ series }: Props) {
  const { parts, view, readErrors } = series;
  const unreadable = new Set(view.reports.flatMap((r, i) => (r.readable ? [] : [i])));
  const changes = view.transitions.filter((t) => t.changesJa.length > 0);
  return (
    <div className="panel series-panel" id="series">
      <h2>
        報の間で変わったこと
        <InfoButton title="この表について">
          <p>
            同じ事故の公表を、{series.order === "date" ? "公表日の順" : "入力した順"}
            に並べ、報ごとに別々に読んだ結果を比べています。印（▲）は、前の報から言い方が変わったところです。
            判定にはこの表ではなく、すべての報を合わせて読んだ結果を使います。
          </p>
          <p>
            「第N報」は、この画面での順番です。公表元の呼び名（第3報など）とは違うことがあります。比較は、Claude
            ではなくプログラムが行っています。
          </p>
        </InfoButton>
      </h2>
      <div className="series-scroll">
        <table className="evidence series-table">
          <thead>
            <tr>
              <th>段階</th>
              {parts.map((p, i) => (
                <th key={p.number}>
                  {p.label}
                  {p.date && <span className="muted"> {p.date}</span>}
                  {unreadable.has(i) && (
                    <span className="muted small">
                      <br />
                      この報だけでは読み取れず
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.rows.map((row) => (
              <tr key={row.tactic}>
                <th scope="row">{row.labelJa}</th>
                {row.cells.map((cell, i) => (
                  <td
                    key={parts[i]?.number ?? i}
                    className={row.changedAt.includes(i) ? "changed" : undefined}
                  >
                    {cell ? (
                      <>
                        {row.changedAt.includes(i) && (
                          <span className="series-mark" role="img" aria-label="変わりました">
                            ▲{" "}
                          </span>
                        )}
                        {cell.textJa}
                      </>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
            <tr>
              <th scope="row">被害額</th>
              {view.reports.map((r, i) => (
                <td key={parts[i]?.number ?? i}>
                  {r.reportedLossJpy !== undefined ? (
                    `${(r.reportedLossJpy / 10_000).toLocaleString("ja-JP")} 万円`
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
              ))}
            </tr>
            <tr>
              <th scope="row">漏えいした情報</th>
              {view.reports.map((r, i) => (
                <td key={parts[i]?.number ?? i}>
                  {r.leakedDataJa.length > 0 ? (
                    r.leakedDataJa.join("、")
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      {changes.length > 0 ? (
        <ul className="series-changes small">
          {changes.map((t) => (
            <li key={t.toLabel}>
              <b>{t.toLabel}</b>：{t.changesJa.join("。")}。
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">報の間で、変わったところはありません。</p>
      )}
      {readErrors.length > 0 && (
        <p className="err small">
          {readErrors.map((e) => `第${e.number}報は別々には読めませんでした`).join("。")}
          。合わせて読んだ結果には含まれています。
        </p>
      )}
    </div>
  );
}
