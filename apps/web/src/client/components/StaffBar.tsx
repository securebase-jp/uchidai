/**
 * 担当者画面の状況の固定帯：未確認・依頼済み・回答ありの件数と、区画の目次。押すとその場所へ移動する。
 * いま見えている区画の目次を強調する（IntersectionObserver）。件数は staff-status で数えたものをそのまま出す
 */
import { useEffect, useState } from "react";
import type { StaffCounts } from "../lib/staff-status.ts";
import { InfoButton } from "./InfoButton.tsx";

type Props = {
  counts: StaffCounts;
  toc: readonly (readonly [string, string])[];
  /** 未確認 → 確認依頼の一覧、依頼済み・回答あり → 送信箱 */
  requestsId: string;
  outboxId: string;
  onJump(id: string): void;
};

export function StaffBar({ counts, toc, requestsId, outboxId, onJump }: Props) {
  const active = useActiveSection(toc.map(([id]) => id));
  const stat = (n: number, label: string, target: string) => (
    <button
      type="button"
      className={`bar-stat${n === 0 ? " zero" : ""}`}
      onClick={() => onJump(target)}
    >
      {label} <b>{n}</b> 件
    </button>
  );
  return (
    <div className="staff-bar">
      <div className="staff-bar-scroll">
        {stat(counts.pending, "未確認", requestsId)}
        {stat(counts.waiting, "依頼済み", outboxId)}
        {stat(counts.answered, "回答あり", outboxId)}
        <span className="bar-sep" aria-hidden="true" />
        <nav className="bar-toc" aria-label="区画の目次">
          {toc.map(([id, label]) => (
            <button
              type="button"
              key={id}
              className={`toc-link${active === id ? " on" : ""}`}
              aria-current={active === id ? "location" : undefined}
              onClick={() => onJump(id)}
            >
              {label}
            </button>
          ))}
        </nav>
      </div>
      <InfoButton title="この帯について" align="end">
        <p>いま何が残っているかの一覧です。押すとその場所へ移動します。</p>
      </InfoButton>
    </div>
  );
}

/** いま画面の上のほうに見えている区画（上の帯に入っているもののうち、いちばん下で始まっているもの） */
function useActiveSection(ids: readonly string[]): string | undefined {
  const [active, setActive] = useState<string | undefined>(ids[0]);
  const key = ids.join(",");
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const list = key.split(",");
    const visible = new Set<string>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.add(e.target.id);
          else visible.delete(e.target.id);
        }
        const last = [...list].reverse().find((id) => visible.has(id));
        if (last) setActive(last);
      },
      { rootMargin: "-56px 0px -55% 0px" },
    );
    for (const id of list) {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, [key]);
  return active;
}
