/**
 * 社長向けの一枚を、ブラウザの中だけで PDF ファイルにする（サーバには何も送らない）。
 * 印刷ダイアログ（window.print）が使えない環境でも、.pdf を保存できる。
 *
 * 方式：印刷用レイアウト（onepager.css の .op-capture 配下は :root.printing と同じ規則）で、
 * 画面の外に A4 縦の「ページ」を組み、ページごとに画像化（html-to-image）して jsPDF で A4 に置く。
 * 節の途中では切らない。.op-pb（2 枚目の先頭）は必ず改ページする。
 * 重いライブラリ（html-to-image、jsPDF）はボタンを押したときだけ読み込む。
 */
import type { Options } from "html-to-image/lib/types";
import { packPages, parseUnicodeRange, rangeCoversAny } from "./pdf-layout.ts";

/** A4 を 96dpi の px で（210mm × 297mm） */
const PAGE_W = 794;
const PAGE_H = 1123;
/** 余白 15mm（印刷の @page と同じ） */
const MARGIN = Math.round((15 * 96) / 25.4);
/** 画像化の倍率。2 倍で約 192dpi（紙面 150dpi 以上） */
const PIXEL_RATIO = 2;
/** JPEG の品質。PNG に比べて jsPDF が速く（PNG は取り込みに 5 秒ほどかかった）、文字の縁も読める */
const JPEG_QUALITY = 0.95;
const FONT_FAMILIES = new Set(["BIZ UDPGothic", "BIZ UDPMincho", "JetBrains Mono"]);

export class PdfExportError extends Error {}

const fontDataCache = new Map<string, Promise<string>>();

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error("フォントを読めませんでした"));
    r.readAsDataURL(blob);
  });
}

function fontDataUrl(url: string): Promise<string> {
  let p = fontDataCache.get(url);
  if (!p) {
    p = fetch(url).then(async (res) => {
      if (!res.ok) throw new Error(`フォントを取得できませんでした（${res.status}）`);
      return blobToDataUrl(await res.blob());
    });
    p.catch(() => fontDataCache.delete(url));
    fontDataCache.set(url, p);
  }
  return p;
}

function* fontFaceRules(list: CSSRuleList): Generator<CSSFontFaceRule> {
  for (const rule of Array.from(list)) {
    if (rule instanceof CSSFontFaceRule) yield rule;
    else if (rule instanceof CSSImportRule && rule.styleSheet)
      yield* fontFaceRules(rule.styleSheet.cssRules);
  }
}

/**
 * 画像化する文書に埋め込む @font-face。BIZ UDP は文字の範囲ごとに分割されている（日本語は 100 個ほど）ので、
 * 一枚に使う文字を含む分割だけを data URL で埋める（全部を埋めると遅く、重い）
 */
async function buildFontEmbedCss(text: string): Promise<string> {
  const codePoints = new Set<number>();
  for (const ch of text) codePoints.add(ch.codePointAt(0) ?? 0);
  const jobs: Promise<string>[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // 別のオリジンのスタイルシートは読めない
    }
    for (const rule of fontFaceRules(rules)) {
      const family = rule.style.getPropertyValue("font-family").replace(/["']/g, "").trim();
      if (!FONT_FAMILIES.has(family)) continue;
      const ranges = parseUnicodeRange(rule.style.getPropertyValue("unicode-range"));
      if (!rangeCoversAny(ranges, codePoints)) continue;
      const m = /url\(["']?([^"')]+)["']?\)\s*format\(["']woff2["']\)/.exec(
        rule.style.getPropertyValue("src"),
      );
      if (!m?.[1]) continue;
      const src = new URL(m[1], sheet.href ?? document.baseURI).href;
      const weight = rule.style.getPropertyValue("font-weight") || "400";
      const style = rule.style.getPropertyValue("font-style") || "normal";
      const unicodeRange = rule.style.getPropertyValue("unicode-range");
      jobs.push(
        fontDataUrl(src).then(
          (data) =>
            `@font-face{font-family:"${family}";font-weight:${weight};font-style:${style};src:url(${data}) format("woff2");font-display:swap;${
              unicodeRange ? `unicode-range:${unicodeRange};` : ""
            }}`,
        ),
      );
    }
  }
  return (await Promise.all(jobs)).join("\n");
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  style: Partial<CSSStyleDeclaration> = {},
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  Object.assign(e.style, style);
  return e;
}

/** 紙（.op-paper）の外枠だけを複製し、指定した節だけを入れる */
function paperWith(paper: HTMLElement, children: Element[]): HTMLElement {
  const copy = paper.cloneNode(false) as HTMLElement;
  for (const c of children) copy.append(c.cloneNode(true));
  return copy;
}

/** 経路図（インライン SVG）の見た目は CSS のクラスで決まっているが、画像化した文書にはそのクラスが届かない。計算後の値を style に写す */
const SVG_PROPS = [
  "fill",
  "fill-opacity",
  "fill-rule",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-linecap",
  "stroke-linejoin",
  "opacity",
  "display",
  "visibility",
  "filter",
  "color",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "letter-spacing",
  "text-anchor",
  "dominant-baseline",
  "paint-order",
];

function inlineSvgStyles(root: HTMLElement): void {
  for (const svg of Array.from(root.querySelectorAll("svg"))) {
    const box = svg.getBoundingClientRect();
    svg.style.width = `${box.width}px`;
    svg.style.height = `${box.height}px`;
    svg.style.display = "block";
    for (const node of Array.from(svg.querySelectorAll("*"))) {
      const computed = getComputedStyle(node);
      const style = (node as SVGElement).style;
      for (const prop of SVG_PROPS) style.setProperty(prop, computed.getPropertyValue(prop));
    }
  }
}

type Built = { host: HTMLElement; pages: HTMLElement[] };

/** 画面の外に A4 のページを組む。節の高さは、実際に並べて測る */
async function buildPages(sheet: HTMLElement): Promise<Built> {
  const paper = sheet.querySelector<HTMLElement>(".op-paper");
  const headRun = sheet.querySelector<HTMLElement>(".op-run-head");
  const footRun = sheet.querySelector<HTMLElement>(".op-run-foot");
  if (!paper || !headRun || !footRun) throw new PdfExportError("一枚の紙が見つかりません");

  // 画面の外に置く（visibility や display を変えると、画像化で消えてしまう）
  const host = el("div", "op-capture", {
    position: "fixed",
    left: "-10000px",
    top: "0",
    width: `${PAGE_W}px`,
    pointerEvents: "none",
  });
  host.setAttribute("aria-hidden", "true");
  document.body.append(host);

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

  const groups = packPages(
    sections.map((s, i) => ({
      height: heights[i] ?? 0,
      breakBefore: s.classList.contains("op-pb"),
    })),
    available,
  );

  const pages = groups.map((idx, n) => {
    const page = el("div", "op-capture-page", {
      position: "relative",
      boxSizing: "border-box",
      width: `${PAGE_W}px`,
      height: `${PAGE_H}px`,
      padding: `${MARGIN}px`,
      background: "#ffffff",
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
    });
    const foot = footRun.cloneNode(true) as HTMLElement;
    foot.style.marginTop = "auto";
    const num = el("span", "", {
      position: "absolute",
      right: `${MARGIN}px`,
      bottom: `${Math.round(MARGIN / 2.6)}px`,
      font: '8pt "JetBrains Mono", ui-monospace, Menlo, monospace',
      color: "#5a6275",
    });
    num.textContent = `${n + 1} / ${groups.length}`;
    page.append(
      headRun.cloneNode(true),
      paperWith(
        paper,
        idx.map((i) => sections[i] as Element),
      ),
      foot,
      num,
    );
    host.append(page);
    return page;
  });
  for (const page of pages) inlineSvgStyles(page);
  return { host, pages };
}

/**
 * ページを画像（JPEG の data URL）にする。html-to-image の toPng は描画の直前に requestAnimationFrame を待つため、
 * 別のタブに切り替えると止まってしまう。SVG までを html-to-image に任せ、画像への描き込みは自前で行う（待たない）
 */
async function pageToJpeg(
  toSvg: (node: HTMLElement, options?: Options) => Promise<string>,
  page: HTMLElement,
  fontEmbedCSS: string,
): Promise<string> {
  const svg = await toSvg(page, {
    width: PAGE_W,
    height: PAGE_H,
    backgroundColor: "#ffffff",
    fontEmbedCSS,
  });
  const img = new Image();
  img.src = svg;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = PAGE_W * PIXEL_RATIO;
  canvas.height = PAGE_H * PIXEL_RATIO;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new PdfExportError("このブラウザでは画像を作れません（canvas）");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** 描き直しの間隔と上限。日本語フォントの取り込みは数百ミリ秒かかることがある */
const SETTLE_WAIT_MS = 250;
const SETTLE_MAX_TRIES = 12;

/**
 * 埋め込んだフォントは、画像化した文書の中で非同期に読み込まれる。最初の描画では間に合わず、
 * 日本語が抜けた（または代わりの書体になった）ページが出ることがある（読み込み後の 2 回目からは正しく出る）。
 * 画像には「フォントの読み込み完了」を知る手段がないので、前回と同じ絵になるまで描き直し、変化が止まったものを使う
 */
async function pageToJpegSettled(
  toSvg: (node: HTMLElement, options?: Options) => Promise<string>,
  page: HTMLElement,
  fontEmbedCSS: string,
): Promise<string> {
  let prev = await pageToJpeg(toSvg, page, fontEmbedCSS);
  for (let i = 0; i < SETTLE_MAX_TRIES; i++) {
    await sleep(SETTLE_WAIT_MS);
    const cur = await pageToJpeg(toSvg, page, fontEmbedCSS);
    if (cur === prev) return cur;
    prev = cur;
  }
  return prev;
}

/** 一枚（.op-sheet）を PDF の Blob にする。ページは A4 縦。失敗は PdfExportError に理由を載せる */
export async function renderOnePagerPdf(sheet: HTMLElement): Promise<Blob> {
  let built: Built | undefined;
  try {
    const [{ toSvg }, { jsPDF }] = await Promise.all([import("html-to-image"), import("jspdf")]);
    built = await buildPages(sheet);
    const fontEmbedCSS = await buildFontEmbedCss(built.host.textContent ?? "");
    await document.fonts.ready;
    const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true });
    doc.setProperties({ title: "uchidai one-pager", creator: "uchidai" });
    for (const [i, page] of built.pages.entries()) {
      const png = await pageToJpegSettled(toSvg, page, fontEmbedCSS);
      if (i > 0) doc.addPage("a4", "portrait");
      doc.addImage(png, "JPEG", 0, 0, 210, 297, undefined, "FAST");
    }
    return doc.output("blob");
  } catch (e) {
    if (e instanceof PdfExportError) throw e;
    throw new PdfExportError(e instanceof Error ? e.message : String(e));
  } finally {
    built?.host.remove();
  }
}

/** Blob をファイルとして保存する（a[download]） */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
