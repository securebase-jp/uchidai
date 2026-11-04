/** 対策ボタンの効き目の分類（効く／効かない／この攻撃には関係しない／適用中）。判定済みの経路の段階を読むだけで、判定はしない */

import { STATE_LABEL } from "./labels.ts";
import type { MeasureDef, Verdict } from "./types.ts";

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

export const FX_CLASS: Record<MeasureEffect["kind"], string> = {
  effective: "fx-green",
  applied: "fx-green",
  ineffective: "fx-red",
  outside: "fx-ink",
};
