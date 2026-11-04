/** 対策ボタン（knowledge/measures.yaml から）。押すと巻き戻して同じ攻撃をもう一度 */
import { FX_CLASS, measureEffect } from "../lib/measure-effect.ts";
import type { Graph, MeasureDef, Verdict } from "../lib/types.ts";
import { InfoButton } from "./InfoButton.tsx";
import { MeasureTable } from "./MeasureTable.tsx";

export type { MeasureEffect } from "../lib/measure-effect.ts";
// 効き目の分類は lib/measure-effect.ts。テストと他の画面のために、ここからも出す
export { measureEffect };

type Props = {
  measures: MeasureDef[];
  selected: string[];
  verdict: Verdict | undefined;
  /** 構成グラフ。渡すと、対策を「対策 × 段階」の表で出す（担当者画面）。無ければ従来のカード（社長画面） */
  graph?: Graph | undefined;
  onToggle(id: string): void;
  onClear(): void;
  plain?: boolean;
  disabled?: boolean;
  /** 対策 ID → 費用の目安（/api/evaluate の measureCosts） */
  costs?: Record<string, { costJa: string; costSourceJa?: string }> | undefined;
};

export function MeasurePanel({
  measures,
  selected,
  verdict,
  graph,
  onToggle,
  onClear,
  plain = false,
  disabled = false,
  costs: verdictCosts,
}: Props) {
  return (
    <div className="panel">
      <h2>
        対策を一つ入れて、もう一度
        {!plain && (
          <InfoButton title="対策ボタンの読み方">
            <p>
              対策の名前を押すと、その対策を入れたカルテで同じ攻撃をもう一度判定し、時間を巻き戻して再生します。
              対策は knowledge/measures.yaml
              に定義したもので、緩和策の有無と属性を書き換えます（根拠は担当者登録）。
              もう一度押すと外れます。
            </p>
            <p>
              表の列は、この攻撃の経路の段階です。緑の●は「その段階に効く」（判定が変わりうる）、赤の×は
              「入れてもその段階では効かない」ことを表し、×を押すと理由が出ます。どの段階にも印が無く
              「関係しない」と出る対策は、この攻撃の経路の判定に使わない対策です。適用中の対策には、
              その段階がいまどの状態かを名前の下に添えます。
            </p>
            <p>
              費用の棒は、金額が分かる対策どうしの長さの比べです。金額は出典（IPA
              の資料）の単価をカルテの人数に掛けた目安で、単価を確認できなかった対策は
              「見積もり待ち」（点線の札）と出します。依頼先と出典の文は、対策の名前に触れると見えます。
            </p>
          </InfoButton>
        )}
      </h2>
      {graph && !plain ? (
        <>
          <MeasureTable
            measures={measures}
            selected={selected}
            verdict={verdict}
            graph={graph}
            costs={verdictCosts}
            onToggle={onToggle}
            disabled={disabled}
          />
          {selected.length > 0 && (
            <button
              type="button"
              className="btn ghost sm mx-clear"
              onClick={onClear}
              disabled={disabled}
            >
              対策を外す
            </button>
          )}
        </>
      ) : (
        <div className="group">
          {measures.map((m) => {
            const on = selected.includes(m.id);
            const fx = measureEffect(m, verdict, on);
            return (
              <button
                type="button"
                key={m.id}
                className="btn measure"
                aria-pressed={on}
                disabled={disabled}
                onClick={() => onToggle(m.id)}
                title={verdictCosts?.[m.id]?.costSourceJa ?? m.costSourceJa ?? ""}
              >
                <span>{m.labelJa}</span>
                {!plain && (
                  <span className="sub">
                    {m.mitigation}
                    {m.requestToJa ? `　依頼先：${m.requestToJa}` : ""}
                    {`　費用：${verdictCosts?.[m.id]?.costJa ?? "ベンダーの見積もり待ち"}`}
                  </span>
                )}
                {fx.textJa && <span className={`fx ${FX_CLASS[fx.kind]}`}>{fx.textJa}</span>}
              </button>
            );
          })}
          {selected.length > 0 && (
            <button type="button" className="btn ghost sm" onClick={onClear} disabled={disabled}>
              対策を外す
            </button>
          )}
        </div>
      )}
    </div>
  );
}
