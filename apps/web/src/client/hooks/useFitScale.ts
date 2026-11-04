/**
 * 舞台（帯＋計器＋構成図＋操作）を画面の幅と高さに合わせて縮める（社長画面をスクロールなしで見せる）。
 * 外側（outer）の位置と幅、内側（inner）の素の大きさを測り、transform: scale() の倍率と外側の高さを返す。
 * 上部バーの分は outer の画面上の位置として自然に差し引かれる。手動の倍率（manual）があればそれを優先する。
 */
import { type RefObject, useLayoutEffect, useState } from "react";
import { fitScale } from "../lib/fit.ts";

/** 舞台の下に残す余白（.wrap:has(.exec) の padding-bottom と合わせる） */
const BOTTOM_GAP = 12;
/** これより狭い幅では自動の縮小をしない（styles.css の 2 列化の境界と同じ） */
const NARROW_LIMIT = 1000;

export type FitScale = {
  /** いま使う倍率（手動があれば手動、なければ自動） */
  scale: number;
  /** 自動で計算した倍率 */
  auto: number;
  /** 縮めた後の高さ（外側に与える）。まだ測れていなければ undefined */
  height: number | undefined;
};

export function useFitScale(
  outer: RefObject<HTMLElement | null>,
  inner: RefObject<HTMLElement | null>,
  manual: number | undefined,
  enabled = true,
  /** 舞台が描かれているか。準備中の画面から切り替わった瞬間に測り直す */
  ready = true,
  /** 変わったら測り直す値（発表モードの切り替えなど、上部バーの有無が変わるとき） */
  revision: unknown = undefined,
): FitScale {
  const [auto, setAuto] = useState(1);
  const [natural, setNatural] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: revision は測り直しの合図として受け取る
  useLayoutEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (!ready || !o || !i) return;
    const measure = () => {
      const top = o.getBoundingClientRect().top + window.scrollY;
      // 下端の「出典」リンク（Footer）がある画面では、その高さの分も空ける（発表モード・デモでは出ない）
      const foot = document.querySelector<HTMLElement>(".site-foot");
      const footH = foot ? foot.offsetHeight + parseFloat(getComputedStyle(foot).marginTop) : 0;
      const availH = window.innerHeight - top - BOTTOM_GAP - footH;
      const availW = o.clientWidth;
      const w = i.offsetWidth;
      const h = i.offsetHeight;
      setNatural(h);
      // 幅 1000px 未満（スマホ・縦並び）では縮めない。縦に積んだ舞台を高さに合わせると
      // 0.4 倍まで縮んで構成図が読めなくなるため、そこでは普通にスクロールさせる
      setAuto(enabled && availW >= NARROW_LIMIT ? fitScale(availW, availH, w, h) : 1);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(i);
    window.addEventListener("resize", measure);
    document.addEventListener("fullscreenchange", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
      document.removeEventListener("fullscreenchange", measure);
    };
  }, [outer, inner, enabled, ready, revision]);

  const scale = manual ?? auto;
  return { scale, auto, height: natural > 0 ? Math.floor(natural * scale) : undefined };
}
