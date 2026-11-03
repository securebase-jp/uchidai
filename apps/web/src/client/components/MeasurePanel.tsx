/** 対策ボタン（knowledge/measures.yaml から）。押すと巻き戻して同じ攻撃をもう一度 */
import { STATE_LABEL } from "../lib/labels.ts";
import type { MeasureDef, Verdict } from "../lib/types.ts";
import { InfoButton } from "./InfoButton.tsx";

type Props = {
  measures: MeasureDef[];
  selected: string[];
  verdict: Verdict | undefined;
  onToggle(id: string): void;
  onClear(): void;
  plain?: boolean;
  disabled?: boolean;
  /** 対策 ID → 費用の目安（/api/evaluate の measureCosts） */
  costs?: Record<string, { costJa: string; costSourceJa?: string }> | undefined;
};

export type MeasureEffect = {
  kind: "effective" | "ineffective" | "outside" | "applied";
  textJa: string;
};

export function measureEffect(
  m: MeasureDef,
  verdict: Verdict | undefined,
  selected: boolean,
): MeasureEffect {
  if (!verdict) return { kind: "outside", textJa: "" };
  const steps = verdict.paths.filter((p) => p.source !== "ai").flatMap((p) => p.steps);
  // 対策が書き換える役割の段階だけを見る（同じ緩和策 ID でも、別の役割の対策は「効かない」にしない）
  const roles = new Set(m.patches.map((p) => p.role));
  const inef = steps.find(
    (s) => roles.has(s.role) && s.ineffective.some((i) => i.mitigation === m.mitigation),
  );
  if (inef) {
    const reason = inef.ineffective.find((i) => i.mitigation === m.mitigation)?.reasonJa ?? "";
    return { kind: "ineffective", textJa: `効かない：${reason}` };
  }
  const eff = steps.find((s) => roles.has(s.role) && s.mitigations.includes(m.mitigation));
  if (eff) {
    if (selected)
      return {
        kind: "applied",
        textJa:
          eff.state === "blocked"
            ? "効いた：ここで止まる"
            : eff.state === "recoverable"
              ? "効いた：復旧できる"
              : `適用中：この段階はまだ「${STATE_LABEL[eff.state]}」${eff.reasonJa ? `（${eff.reasonJa}）` : ""}`,
      };
    return { kind: "effective", textJa: `この段階に効く：${eff.labelJa ?? eff.role}` };
  }
  if (selected) return { kind: "applied", textJa: "適用中（この攻撃には関係しない）" };
  return { kind: "outside", textJa: "この攻撃には関係しない" };
}

const FX_CLASS: Record<MeasureEffect["kind"], string> = {
  effective: "fx-green",
  applied: "fx-green",
  ineffective: "fx-red",
  outside: "fx-ink",
};

export function MeasurePanel({
  measures,
  selected,
  verdict,
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
              ボタンを押すと、その対策を入れたカルテで同じ攻撃をもう一度判定し、時間を巻き戻して再生します。
              対策は knowledge/measures.yaml
              に定義したもので、緩和策の有無と属性を書き換えます（根拠は担当者登録）。
              もう一度押すと外れます。
            </p>
            <p>
              ボタンの下の一行は、いまの経路での効き目です。「この段階に効く」はその段階の判定が変わりうること、
              「効かない」は入れてもこの攻撃では効かないことと理由、「この攻撃には関係しない」はこの経路の判定に
              使わない対策であることを表します。適用中の対策には、その段階がいまどの状態かを添えます。
            </p>
            <p>
              費用の目安は出典（IPA
              の資料など）を確認できた項目だけに入れ、無いものは「ベンダーの見積もり待ち」と
              出します。出典はボタンに触れると見えます。
            </p>
          </InfoButton>
        )}
      </h2>
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
    </div>
  );
}
