/** 対策ボタン（knowledge/measures.yaml から）。押すと巻き戻して同じ攻撃をもう一度 */
import type { MeasureDef, Verdict } from "../lib/types.ts";

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
  const inef = steps.find((s) => s.ineffective.some((i) => i.mitigation === m.mitigation));
  if (inef) {
    const reason = inef.ineffective.find((i) => i.mitigation === m.mitigation)?.reasonJa ?? "";
    return { kind: "ineffective", textJa: `効かない：${reason}` };
  }
  const roles = new Set(m.patches.map((p) => p.role));
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
              : "適用中",
      };
    return { kind: "effective", textJa: `この段階に効く：${eff.labelJa ?? eff.role}` };
  }
  return { kind: "outside", textJa: "この経路の外" };
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
      <h2>対策を一つ入れて、もう一度</h2>
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
