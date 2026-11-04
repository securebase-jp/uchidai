/**
 * 数値の入力：よくある値のボタンの列 ＋ 数値の欄。
 * ボタンを押すと欄に入って保存され、欄はそのまま直せる（直接入力のほうが望ましい値はそのまま入れられる）。
 * 欄は BlurInput と同じく、欄を離れた（Enter も含む）ときだけ保存する。今の値に当たるボタンは aria-pressed で示す
 */
import { Check } from "lucide-react";
import { useEffect, useState } from "react";
import { numberFromText, type Preset } from "../lib/choices.ts";

type Props = {
  value: number | undefined;
  presets: Preset[];
  /** 確定した値（欄を空にして離れたときは undefined。allowEmpty が false なら元に戻す） */
  onCommit(v: number | undefined): void;
  /** ボタン列の頭に出す短い語（例：年商）。ボタンの数字が何を指すかを示す */
  presetsCaption?: string;
  /** 欄の右に出す単位（人、円、日） */
  unit?: string;
  /** 欄の id（<label htmlFor> から結ぶ） */
  id?: string;
  /** ボタン列と欄の読み上げ名 */
  ariaLabel: string;
  min?: number;
  step?: number;
  placeholder?: string;
  /** 空で確定すると値を消す（既定は true） */
  allowEmpty?: boolean;
  /** 欄の右に添える読みやすい表記（例：1,000万円） */
  readout?(n: number): string;
  /** 小さく並べる（表の中など） */
  compact?: boolean;
  disabled?: boolean;
};

export function ChoiceNumber({
  value,
  presets,
  onCommit,
  presetsCaption,
  unit,
  id,
  ariaLabel,
  min = 0,
  step = 1,
  placeholder,
  allowEmpty = true,
  readout,
  compact = false,
  disabled = false,
}: Props) {
  const [text, setText] = useState(value === undefined ? "" : String(value));
  useEffect(() => setText(value === undefined ? "" : String(value)), [value]);

  const commit = () => {
    const r = numberFromText(text, { min, allowEmpty });
    if (r.kind === "revert" || r.value === value) {
      setText(value === undefined ? "" : String(value));
      return;
    }
    onCommit(r.value);
  };

  return (
    <div className={`cn${compact ? " compact" : ""}`}>
      <fieldset className="cn-presets">
        <legend className="visually-hidden">{ariaLabel}：よくある値</legend>
        {presetsCaption && <span className="cn-caption">{presetsCaption}</span>}
        {presets.map((p) => {
          const pressed = value === p.value;
          return (
            <button
              type="button"
              key={p.value}
              className="cn-btn"
              aria-pressed={pressed}
              disabled={disabled}
              onClick={() => {
                if (!pressed) onCommit(p.value);
              }}
            >
              {pressed && <Check size={13} strokeWidth={3} aria-hidden="true" />}
              {p.label ?? p.value.toLocaleString("ja-JP")}
            </button>
          );
        })}
      </fieldset>
      <span className="cn-field">
        <input
          className="in num"
          type="number"
          inputMode="numeric"
          value={text}
          min={min}
          step={step}
          disabled={disabled}
          aria-label={ariaLabel}
          {...(id ? { id } : {})}
          {...(placeholder ? { placeholder } : {})}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
        />
        {unit && <span className="cn-unit">{unit}</span>}
        {readout && value !== undefined && <span className="cn-readout">{readout(value)}</span>}
      </span>
    </div>
  );
}
