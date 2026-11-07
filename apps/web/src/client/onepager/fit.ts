/**
 * 一枚を 2 ページに収めるための「詰め方の段」（印刷・PDF だけ。画面には何も隠さない）。DOM に依らない部分。
 *
 * 一枚は 1 枚目（結論・何が起きるか・止まる業務）と 2 枚目（金額・期限・対策・出典）に分かれる。
 * 内容の量は事故と会社で大きく違い、そのままでは 3 ページ以上になる組み合わせがある（Issue #12）。
 * 段 0 は従来のまま。収まらないときだけ、1 枚目は a、2 枚目は b の段を 1 つずつ上げ、収まる最初の段を使う：
 * 段が上がるほど、見せる項目の上限が下がり（残りは「ほか N 件」）、経路図が小さくなる。
 * 判定・数字は変えない。隠すのは印刷・PDF の表示だけで、画面（カルテ・担当者画面・一枚の画面表示）には全部残る。
 * 段は <article class="op-paper"> の data-fit-a / data-fit-b に付け、onepager.css の同じ段の規則が効く。
 */

/** 段の最大（0 は従来のまま） */
export const FIT_MAX = { a: 3, b: 3 } as const;

/** 印刷で見せる項目数の上限。添字は段。Infinity は上限なし。onepager.css の nth-child の規則と同じ値にする（試験で照合） */
export const KEEP = {
  /** 何が起きるか（1 枚目。段 a） */
  lines: [Number.POSITIVE_INFINITY, 6, 4, 3],
  /** 止まる業務（1 枚目。段 a） */
  stopped: [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, 3, 3],
  /** 対策（2 枚目。段 b） */
  measures: [Number.POSITIVE_INFINITY, 6, 4, 4],
  /** 期限（2 枚目。段 b） */
  deadlines: [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, 4],
} as const;

export type FitList = keyof typeof KEEP;

/** 項目が total 件のとき、段のどこかで切られる位置（「ほか N 件」を出す位置）。昇順で重複なし */
export function cutPoints(list: FitList, total: number): number[] {
  const set = new Set<number>();
  for (const k of KEEP[list]) if (Number.isFinite(k) && k < total) set.add(k);
  return [...set].sort((x, y) => x - y);
}

export type FitLevels = { a: number; b: number };

export type FitMeasure = {
  /** いまの段で組んだときのページ数 */
  pages: number;
  /** 強制改ページの節（.op-pb）の前、つまり 1 枚目に入る節の高さの合計が、1 ページに使える高さを超えているか */
  part1Over: boolean;
  /** 強制改ページの節があるか（経路図の無い一枚、共有リンクには無い） */
  hasBreak: boolean;
};

/**
 * 2 ページに収まらないとき、次に試す段。これ以上上げられなければ undefined。
 * 1 枚目が溢れているなら a、そうでなければ b を上げる。改ページの固定が無い一枚は a と b を交互に上げる
 */
export function nextFit(cur: FitLevels, m: FitMeasure): FitLevels | undefined {
  if (m.pages <= 2) return undefined;
  const canA = cur.a < FIT_MAX.a;
  const canB = cur.b < FIT_MAX.b;
  if (m.hasBreak) {
    if (m.part1Over && canA) return { ...cur, a: cur.a + 1 };
    if (canB) return { ...cur, b: cur.b + 1 };
    if (canA) return { ...cur, a: cur.a + 1 };
    return undefined;
  }
  if (canA && (cur.a <= cur.b || !canB)) return { ...cur, a: cur.a + 1 };
  if (canB) return { ...cur, b: cur.b + 1 };
  return undefined;
}
