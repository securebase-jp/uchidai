/**
 * 一枚の紙面の寸法を、実際に並べて測る（PDF 書き出しと、2 ページに収める詰め方の段の決定で共有する）。
 * 印刷用レイアウト（onepager.css の .op-capture 配下は :root.printing と同じ規則）で、A4 縦の本文の幅に節を並べ、
 * 節の高さを測って packPages でページに割り付ける。window.print は使わない。
 */
import { type FitLevels, type FitMeasure, nextFit } from "./fit.ts";
import { packPages } from "./pdf-layout.ts";

/** A4 を 96dpi の px で（210mm × 297mm） */
export const PAGE_W = 794;
export const PAGE_H = 1123;
/** 余白 15mm（印刷の @page と同じ） */
export const MARGIN = Math.round((15 * 96) / 25.4);

/** 割り付けで見込む安全な余白（px）。測定と描画・印刷の端数のずれで、あと少しの節が溢れないようにする */
export const SAFETY_PX = 6;

export class PdfExportError extends Error {}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  style: Partial<CSSStyleDeclaration> = {},
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  Object.assign(e.style, style);
  return e;
}

/** 紙（.op-paper）の外枠だけを複製し、指定した節だけを入れる（詰め方の段は属性ごと写る） */
export function paperWith(paper: HTMLElement, children: Element[]): HTMLElement {
  const copy = paper.cloneNode(false) as HTMLElement;
  for (const c of children) copy.append(c.cloneNode(true));
  return copy;
}

/** 画面の外に置く入れ物（visibility や display を変えると、画像化で消えてしまう） */
export function captureHost(): HTMLElement {
  const host = el("div", "op-capture", {
    position: "fixed",
    left: "-10000px",
    top: "0",
    width: `${PAGE_W}px`,
    pointerEvents: "none",
  });
  host.setAttribute("aria-hidden", "true");
  document.body.append(host);
  return host;
}

export type PageMeasure = {
  /** ページごとの節の番号 */
  groups: number[][];
  /** 節の高さ（px。次の節の上端までを含む） */
  heights: number[];
  /** 1 ページに使える高さ（px。余白と走り見出しを除く） */
  available: number;
  /** ページごとの余裕（px。負なら溢れている） */
  slack: number[];
  /** 強制改ページの節（.op-pb）の前に入る節の高さの合計が、使える高さを超えているか */
  part1Over: boolean;
  hasBreak: boolean;
};

/** 実際に並べて、節の高さとページの割り付けを測る。host は呼び出し側が用意して片づける */
export async function measurePages(host: HTMLElement, sheet: HTMLElement) {
  const paper = sheet.querySelector<HTMLElement>(".op-paper");
  const headRun = sheet.querySelector<HTMLElement>(".op-run-head");
  const footRun = sheet.querySelector<HTMLElement>(".op-run-foot");
  if (!paper || !headRun || !footRun) throw new PdfExportError("一枚の紙が見つかりません");

  const inner = PAGE_W - 2 * MARGIN;
  const measure = el("div", "", { width: `${inner}px` });
  const sections = Array.from(paper.children);
  measure.append(headRun.cloneNode(true), paperWith(paper, sections), footRun.cloneNode(true));
  host.append(measure);
  await document.fonts.ready;
  const [mHead, mPaper, mFoot] = Array.from(measure.children) as HTMLElement[];
  if (!mHead || !mPaper || !mFoot) throw new PdfExportError("ページを組めませんでした");
  const rects = Array.from(mPaper.children).map((c) => c.getBoundingClientRect());
  // 節の間の隙間も節に含める（次の節の上端までを、その節の高さとする）
  const heights = rects.map((r, i) => (rects[i + 1]?.top ?? r.bottom) - r.top);
  const running = mHead.getBoundingClientRect().height + mFoot.getBoundingClientRect().height;
  const available = PAGE_H - 2 * MARGIN - running;
  host.removeChild(measure);

  const breakAt = sections.findIndex((s) => s.classList.contains("op-pb"));
  const groups = packPages(
    sections.map((s, i) => ({
      height: heights[i] ?? 0,
      breakBefore: s.classList.contains("op-pb"),
    })),
    available - SAFETY_PX,
  );
  const slack = groups.map((idx) => available - idx.reduce((sum, i) => sum + (heights[i] ?? 0), 0));
  const part1 = breakAt < 0 ? 0 : heights.slice(0, breakAt).reduce((a, b) => a + b, 0);
  const usable = available - SAFETY_PX;
  return {
    paper,
    headRun,
    footRun,
    sections,
    heights,
    available,
    groups,
    slack,
    part1Over: breakAt >= 0 && part1 > usable,
    hasBreak: breakAt >= 0,
  };
}

/** ページ数と各ページの余裕だけを測る（画像は作らない）。寸法の確認用 */
export async function measureOnePager(sheet: HTMLElement): Promise<PageMeasure> {
  const host = captureHost();
  try {
    const { groups, heights, available, slack, part1Over, hasBreak } = await measurePages(
      host,
      sheet,
    );
    return { groups, heights, available, slack, part1Over, hasBreak };
  } finally {
    host.remove();
  }
}

const levelOf = (paper: HTMLElement): FitLevels => ({
  a: Number(paper.dataset.fitA ?? 0) || 0,
  b: Number(paper.dataset.fitB ?? 0) || 0,
});

function setLevels(paper: HTMLElement, l: FitLevels): void {
  if (l.a > 0) paper.dataset.fitA = String(l.a);
  else delete paper.dataset.fitA;
  if (l.b > 0) paper.dataset.fitB = String(l.b);
  else delete paper.dataset.fitB;
}

/**
 * 2 ページに収まる最初の詰め方の段を探し、紙（.op-paper）の data-fit-a / data-fit-b に付ける。段 0 から始めて 1 つずつ上げる。
 * 付けた属性は印刷・PDF の規則（onepager.css）だけが読み、画面の表示は変わらない。上限まで上げても収まらなければ、その段のまま返す
 */
export function fitSheet(sheet: HTMLElement): Promise<{ levels: FitLevels } & FitMeasure> {
  // 同じ紙への探索が重なると互いの属性を書き換えるので、順に行う
  const prev = queue.get(sheet) ?? Promise.resolve();
  const run = prev.catch(() => undefined).then(() => fitSheetNow(sheet));
  queue.set(sheet, run);
  return run;
}

const queue = new WeakMap<HTMLElement, Promise<unknown>>();

async function fitSheetNow(sheet: HTMLElement): Promise<{ levels: FitLevels } & FitMeasure> {
  const paper = sheet.querySelector<HTMLElement>(".op-paper");
  if (!paper) throw new PdfExportError("一枚の紙が見つかりません");
  const host = captureHost();
  try {
    let levels: FitLevels = { a: 0, b: 0 };
    setLevels(paper, levels);
    for (;;) {
      const m = await measurePages(host, sheet);
      const fm: FitMeasure = {
        pages: m.groups.length,
        part1Over: m.part1Over,
        hasBreak: m.hasBreak,
      };
      const next = nextFit(levels, fm);
      if (!next) return { levels: levelOf(paper), ...fm };
      levels = next;
      setLevels(paper, levels);
    }
  } finally {
    host.remove();
  }
}
