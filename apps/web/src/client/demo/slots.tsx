/**
 * 差し込み口：場面 4 の外部確認の再生（slot:recon）は components/ReconReplay.tsx（記録の再生、ネットワークに出ない）、
 * ほかの 3 つ（AI攻撃者、ベンダー確認、知見なし AI との並置）は slot-components.tsx の実際の画面がつながっている。
 *
 * 接続のしかた：SLOTS の該当キーに、(props: SlotProps) => ReactNode の部品を入れる。
 *   import { AiAttackerDemo } from "../components/AiAttackerDemo.tsx";
 *   SLOTS["slot:recon"] = ReconReplaySlot;   // props は { elapsed, seconds }。seconds は差し込み口が出ている長さ
 * props.elapsed は場面の開始からの秒数（一時停止中は進まない）。props.seconds は場面の長さ。
 * 部品は画面の右下に重ねて描かれる（.demo-slot）。全画面にしたいときは .demo-slot.full を付ける。
 * 未接続のあいだは、時刻だけ確保した空の枠（プレースホルダ）を描く。
 */
import type { ComponentType } from "react";
import { ReconReplaySlot } from "../components/ReconReplay.tsx";
import type { OverlayId } from "./schema.ts";
import { AiAttackerSlot, ComparisonSlot, RequestSlot } from "./slot-components.tsx";

export type SlotProps = {
  elapsed: number;
  seconds: number;
  /** 場面の原稿（画面で起きること） */
  onScreen?: string | undefined;
};

export type SlotId = Extract<OverlayId, `slot:${string}`>;

export const SLOT_TITLE: Record<SlotId, [string, string]> = {
  "slot:recon": [
    "外部確認の再生",
    "demo-sec.com を実際に外部確認した記録（DNS の応答と証明書の公開ログ）を再生する。ReconReplay をつなぐ",
  ],
  "slot:attacker": ["AI攻撃者", "保守ベンダーの遠隔保守の入口を見つけ、検証して表示する（S6）"],
  "slot:request": ["ベンダーへの確認", "未確認の段階を一問だけ依頼し、回答で判定を更新する（S7）"],
  "slot:comparison": ["知見なし AI との比較", "効く／効かない／経路の外 に振り分けて並べる（S6）"],
};

export const SLOTS: Record<SlotId, ComponentType<SlotProps> | undefined> = {
  "slot:recon": ReconReplaySlot, // 場面 4 前半：demo-sec.com の外部確認の記録の再生（ネットワークに出ない）
  "slot:attacker": AiAttackerSlot,
  "slot:request": RequestSlot,
  "slot:comparison": ComparisonSlot,
};

export function SlotPlaceholder({ id, elapsed, seconds }: SlotProps & { id: SlotId }) {
  const [title, desc] = SLOT_TITLE[id];
  const k = Math.min(1, elapsed / Math.max(1, seconds));
  return (
    <div className="demo-slot placeholder" role="note">
      <div className="hd">
        <span>{title}</span>
        <span className="mono">差し込み口</span>
      </div>
      <p>{desc}</p>
      <p className="muted small">
        統合後、この枠に実際の画面が入ります。いまは時刻だけ確保しています。
      </p>
      <div className="bar" aria-hidden="true">
        <span className="fill" style={{ width: `${k * 100}%` }} />
      </div>
    </div>
  );
}
