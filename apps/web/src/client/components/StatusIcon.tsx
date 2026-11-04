/**
 * 段階の状態を表す共通のアイコン（全画面で同じ形と色にする）。
 * 色だけに頼らないよう、形も状態ごとに変え、読み上げ用の名前（aria-label）と、任意で短い語を添える。
 * アイコンは Lucide（ISC ライセンス）。出典は「データの扱いと出典」（knowledge/sources.yaml）と NOTICE
 */
import {
  CircleHelp,
  CircleX,
  type LucideIcon,
  RotateCcw,
  ShieldCheck,
  UserRound,
} from "lucide-react";

export type StepState = "blocked" | "recoverable" | "unknown" | "human" | "breached";

type Def = { Icon: LucideIcon; labelJa: string; tone: "green" | "amber" | "red" };

export const STATE_ICON: Record<StepState, Def> = {
  blocked: { Icon: ShieldCheck, labelJa: "止まる", tone: "green" },
  recoverable: { Icon: RotateCcw, labelJa: "復旧できる", tone: "green" },
  unknown: { Icon: CircleHelp, labelJa: "未確認", tone: "amber" },
  human: { Icon: UserRound, labelJa: "人次第", tone: "amber" },
  breached: { Icon: CircleX, labelJa: "突破される", tone: "red" },
};

type Props = {
  state: StepState;
  /** アイコンの横に出す語（突破のときは型紙の言葉「暗号化される」などに差し替えられる）。無ければアイコンだけ */
  labelJa?: string;
  /** 語を出すか（既定は出さない。アイコンだけでも読み上げ名は付く） */
  showLabel?: boolean;
  size?: number;
};

export function StatusIcon({ state, labelJa, showLabel = false, size = 16 }: Props) {
  const def = STATE_ICON[state];
  const text = labelJa ?? def.labelJa;
  return (
    <span className={`st-icon tone-${def.tone}`} role="img" aria-label={text}>
      <def.Icon size={size} strokeWidth={2.2} aria-hidden="true" />
      {showLabel && <span className="st-icon-label">{text}</span>}
    </span>
  );
}
