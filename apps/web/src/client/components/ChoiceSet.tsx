/**
 * 2〜5 択のボタン（単一選択）。今の選択は aria-pressed で示す（色だけに頼らず、チェックの印も付ける）。
 * 押すと onChange(value)。選び直しはほかのボタンを押す
 */
import { Check } from "lucide-react";

export type ChoiceOption<T extends string | number | boolean> = {
  value: T;
  labelJa: string;
  /** ボタンの title（ホバーで出る短い補足） */
  titleJa?: string;
};

type Props<T extends string | number | boolean> = {
  options: ChoiceOption<T>[];
  /** 今の選択（どれにも当たらなければ何も押された状態にならない） */
  value: T | undefined;
  onChange(v: T): void;
  /** グループの読み上げ名 */
  ariaLabel: string;
  disabled?: boolean;
  /** 小さく並べる（表の中など） */
  compact?: boolean;
};

export function ChoiceSet<T extends string | number | boolean>({
  options,
  value,
  onChange,
  ariaLabel,
  disabled = false,
  compact = false,
}: Props<T>) {
  return (
    <fieldset className={`cs${compact ? " compact" : ""}`}>
      <legend className="visually-hidden">{ariaLabel}</legend>
      {options.map((o) => {
        const pressed = value === o.value;
        return (
          <button
            type="button"
            key={String(o.value)}
            className="cs-btn"
            aria-pressed={pressed}
            disabled={disabled}
            {...(o.titleJa ? { title: o.titleJa } : {})}
            onClick={() => {
              if (!pressed) onChange(o.value);
            }}
          >
            {pressed && <Check size={14} strokeWidth={3} aria-hidden="true" />}
            {o.labelJa}
          </button>
        );
      })}
    </fieldset>
  );
}
