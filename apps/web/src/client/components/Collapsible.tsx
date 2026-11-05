/**
 * 担当者画面の下の区画を、見出し行だけにして押すと開く枠。中身（パネル）は変えず、外側の開閉だけを足す。
 * - 既定は閉じる。forceOpen が真のあいだは開く（未確認がある、AI 攻撃者の実行中など）。押して閉じた後でも、
 *   forceOpen が偽から真に変わったときは開き直す
 * - 中身は閉じていても読み込んだまま（hidden）にして、AI 攻撃者の実行結果などを失わない
 * - jumpTo から区画の id（または contains の id）の移動が来たら、先に開く
 * - plain（デモモード）のときは枠を足さず、従来と同じ DOM（余白の div だけ）で出す
 * - 開閉の記憶は画面を離れても覚える（このタブのあいだだけ。保存はしない）。動きは使わない（動きを減らす設定にも沿う）
 */
import { type ReactNode, useEffect, useId, useRef, useState } from "react";

export const REVEAL_EVENT = "staff:reveal";

const remembered = new Map<string, boolean>();

type Props = {
  id: string;
  title: string;
  /** 見出し行の件数・状態のバッジ */
  badge?: ReactNode;
  /** 真のあいだは開く */
  forceOpen?: boolean;
  /** この枠の中にある、移動先の id（開いてから移動する） */
  contains?: string[];
  /** デモモード：枠を足さず、従来と同じ並びで出す */
  plain?: boolean;
  /** plain のとき、従来から付けていた id（無ければ付けない） */
  legacyId?: string;
  children: ReactNode;
};

export function Collapsible({
  id,
  title,
  badge,
  forceOpen = false,
  contains = [],
  plain = false,
  legacyId,
  children,
}: Props) {
  const [userOpen, setUserOpen] = useState<boolean | undefined>(() => remembered.get(id));
  const bodyId = useId();
  const first = useRef(true);
  const key = contains.join(",");

  // 自動で開く条件が、偽から真になったとき：閉じていても開き直す
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (forceOpen) {
      remembered.delete(id);
      setUserOpen(undefined);
    }
  }, [forceOpen, id]);

  useEffect(() => {
    if (plain) return;
    const targets = new Set([id, ...key.split(",").filter(Boolean)]);
    const onReveal = (e: Event) => {
      const want = (e as CustomEvent<string>).detail;
      if (!targets.has(want)) return;
      remembered.set(id, true);
      setUserOpen(true);
    };
    window.addEventListener(REVEAL_EVENT, onReveal);
    return () => window.removeEventListener(REVEAL_EVENT, onReveal);
  }, [id, key, plain]);

  if (plain) {
    return (
      <div style={{ marginTop: 12 }} {...(legacyId ? { id: legacyId } : {})}>
        {children}
      </div>
    );
  }

  const open = userOpen ?? forceOpen;
  const toggle = () => {
    remembered.set(id, !open);
    setUserOpen(!open);
  };
  return (
    <section className={`coll${open ? " open" : ""}`} id={id} style={{ marginTop: 12 }}>
      <h2 className="coll-h">
        <button
          type="button"
          className="coll-btn"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={toggle}
        >
          <span className="coll-chev" aria-hidden="true" />
          <span className="coll-title">{title}</span>
          {badge && <span className="coll-badge">{badge}</span>}
        </button>
      </h2>
      <div id={bodyId} hidden={!open} className="coll-body">
        {children}
      </div>
    </section>
  );
}
