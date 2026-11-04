/**
 * 対策 × 段階の表（担当者画面）。行＝対策、列＝攻撃の経路の段階、セル＝効く（●）／効かない（×。押すと理由）。
 * 経路に関係しない対策は行の右に札。費用は横棒（金額が分かるものは長さで比べる）。
 * 行を押すと、その対策を入れたカルテで同じ攻撃をもう一度判定する（行の名前のボタンが行全体に広がる）
 */
import { type CSSProperties, useEffect, useId, useMemo, useRef, useState } from "react";
import { useFitInViewport } from "../hooks/useFitInViewport.ts";
import { FX_CLASS, measureEffect } from "../lib/measure-effect.ts";
import { type CostCell, costCells, measureColumns, measureRow } from "../lib/measure-table.ts";
import type { Graph, MeasureDef, Verdict } from "../lib/types.ts";
import { StaffSourceRef } from "./StaffSourceRef.tsx";

type Props = {
  measures: MeasureDef[];
  selected: string[];
  verdict: Verdict | undefined;
  graph: Graph | undefined;
  costs?: Record<string, { costJa: string; costSourceJa?: string }> | undefined;
  onToggle(id: string): void;
  disabled?: boolean;
};

const QUOTE = "ベンダーの見積もり待ち";

export function MeasureTable({
  measures,
  selected,
  verdict,
  graph,
  costs,
  onToggle,
  disabled = false,
}: Props) {
  const cols = useMemo(
    () => (verdict && graph ? measureColumns(verdict, graph, measures) : []),
    [verdict, graph, measures],
  );
  const cost = useMemo(
    () =>
      costCells(Object.fromEntries(measures.map((m) => [m.id, costs?.[m.id]?.costJa ?? QUOTE]))),
    [measures, costs],
  );
  const style = { "--n": Math.max(cols.length, 1) } as CSSProperties;
  return (
    <table className="mx" aria-label="対策と、攻撃の経路の段階の表" style={style}>
      <thead>
        <tr className="mx-row mx-head" style={style}>
          <th scope="col">対策</th>
          {cols.map((c) => (
            <th scope="col" className="mx-col" key={c.key} title={c.stageJa}>
              {c.label}
            </th>
          ))}
          <th scope="col" className="mx-cost-h">
            費用の目安
            <StaffSourceRef id="ipa-sme-jirei-cost" />
          </th>
        </tr>
      </thead>
      <tbody>
        {measures.map((m) => {
          const on = selected.includes(m.id);
          const fx = measureEffect(m, verdict, on);
          const cells = verdict ? measureRow(m, verdict, cols) : cols.map(() => undefined);
          const unrelated = Boolean(verdict) && cells.every((c) => c === undefined);
          const source = costs?.[m.id]?.costSourceJa ?? m.costSourceJa;
          const hint = [m.requestToJa ? `依頼先：${m.requestToJa}` : "", source ?? ""]
            .filter(Boolean)
            .join("　");
          return (
            <tr
              className={`mx-row${on ? " on" : ""}${unrelated ? " off" : ""}`}
              key={m.id}
              style={style}
            >
              <th scope="row" className="mx-name">
                <button
                  type="button"
                  className="btn measure"
                  aria-pressed={on}
                  disabled={disabled}
                  onClick={() => onToggle(m.id)}
                  title={hint}
                >
                  <span>{m.labelJa}</span>
                  <span className="sub">
                    {m.mitigation}
                    {m.requestToJa ? `　依頼先：${m.requestToJa}` : ""}
                  </span>
                </button>
                {on && fx.textJa && (
                  <span className={`fx mx-fx ${FX_CLASS[fx.kind]}`}>{fx.textJa}</span>
                )}
              </th>
              {unrelated ? (
                <td className="mx-none" colSpan={Math.max(cols.length, 1)}>
                  <span className="mx-tag">関係しない</span>
                </td>
              ) : (
                cols.map((c, i) => {
                  const cell = cells[i];
                  return (
                    <td className="mx-cell" key={c.key} data-stage={c.label}>
                      {cell?.kind === "effective" && (
                        <span className="mx-ok" role="img" aria-label={`${c.label}に効く`}>
                          ●
                        </span>
                      )}
                      {cell?.kind === "ineffective" && (
                        <ReasonPop stage={c.label} reasonJa={cell.reasonJa} />
                      )}
                    </td>
                  );
                })
              )}
              <td className="mx-cost">
                <CostView cell={cost[m.id]} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function CostView({ cell }: { cell: CostCell | undefined }) {
  if (!cell) return null;
  if (cell.kind === "bar")
    return (
      <>
        <span className="mx-bar" aria-hidden="true">
          <span className="mx-bar-fill" style={{ width: `${Math.round(cell.ratio * 100)}%` }} />
        </span>
        <span className="mx-cost-text">{cell.textJa}</span>
      </>
    );
  if (cell.kind === "quote") return <span className="mx-tag dashed">{cell.textJa}</span>;
  if (cell.kind === "internal") return <span className="mx-tag">{cell.textJa}</span>;
  return <span className="mx-cost-text">{cell.textJa}</span>;
}

/** 「効かない」の ×。押すと、効かない理由が吹き出し（情報ボタンと同じ見た目）で出る */
function ReasonPop({ stage, reasonJa }: { stage: string; reasonJa: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLSpanElement>(null);
  const pop = useRef<HTMLElement>(null);
  useFitInViewport(pop, open);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <span className="info mx-pop" ref={root}>
      <button
        type="button"
        className="mx-x"
        aria-label={`${stage}には効かない。理由を見る`}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
      >
        ×
      </button>
      {open && (
        <section className="info-pop" id={id} aria-label="効かない理由" ref={pop}>
          <div className="info-title">効かない理由</div>
          <div className="info-body">
            <p>{reasonJa}</p>
          </div>
        </section>
      )}
    </span>
  );
}
