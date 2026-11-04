/** 時間軸の出来事の種類ごとのアイコン（Lucide、ISC）。担当者画面の時間軸と、社長向けの一枚の期限の図で共有する */
import {
  Banknote,
  CirclePause,
  Handshake,
  type LucideIcon,
  Scale,
  Siren,
  Umbrella,
  Wrench,
} from "lucide-react";

export const KIND_ICON: Record<string, LucideIcon> = {
  legal: Scale,
  partner: Handshake,
  insurance: Umbrella,
  police: Siren,
  business_stop: CirclePause,
  recovery: Wrench,
  money: Banknote,
};

export const iconOf = (kind: string): LucideIcon => KIND_ICON[kind] ?? CirclePause;
