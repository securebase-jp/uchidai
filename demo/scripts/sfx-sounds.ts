/**
 * 効果音のレシピ。すべて ffmpeg の lavfi（sine、aevalsrc、anoisesrc と afade、aecho、alimiter など）だけで合成する。
 * 外部の音素材・ダウンロードは使わない。乱数は anoisesrc の seed を固定するので、何度作っても同じ WAV になる。
 * 依存なし。ffmpeg の呼び出し（synth-sfx.ts）とは分けてあるので、テストから ffmpeg なしでコマンドを組み立てられる。
 */

export const SAMPLE_RATE = 48000;
/** 合成した音のピークの上限（線形）。0.45 は約 -6.9 dBFS（-6 dBFS 以下にする約束） */
export const PEAK_LIMIT = 0.45;

export const SOUND_NAMES = [
  "message",
  "wall-up",
  "wall-down",
  "tick",
  "scan",
  "flip",
  "verify",
  "count",
  "impact",
  "shield-bounce",
  "green-spread",
] as const;
export type SoundName = (typeof SOUND_NAMES)[number];

type Layer = {
  /** 層の開始（音の先頭からの秒） */
  at: number;
  dur: number;
  /** 層の音量（線形） */
  vol: number;
  /** 立ち上がり（秒）。既定 0.003 */
  attack?: number;
  /** 減衰の長さ（秒、層の終わりまで）。既定は層の長さの残り全部 */
  release?: number;
  /** 層の最後に足すフィルタ（帯域の制限など） */
  fx?: string;
} & (
  | { kind: "tone"; f: number }
  | { kind: "sweep"; f0: number; f1: number }
  | { kind: "noise"; color: "white" | "pink" | "brown"; seed: number }
);

export type Recipe = {
  name: SoundName;
  /** 一言の説明（--list に出す） */
  desc: string;
  /** 音の全体の長さ（秒）。0.05〜2 秒 */
  dur: number;
  layers: Layer[];
  /** 層を混ぜた後の音量の補正（dB）。ピークがほぼ -7.5 dBFS にそろうよう、実測の値で決めてある */
  trimDb: number;
  /** 全体にかける反響 aecho の引数（in_gain:out_gain:delays:decays） */
  echo?: string;
};

const tone = (f: number, at: number, dur: number, vol: number, o: Partial<Layer> = {}): Layer =>
  ({ kind: "tone", f, at, dur, vol, ...o }) as Layer;
const sweep = (
  f0: number,
  f1: number,
  at: number,
  dur: number,
  vol: number,
  o: Partial<Layer> = {},
): Layer => ({ kind: "sweep", f0, f1, at, dur, vol, ...o }) as Layer;
const noise = (
  color: "white" | "pink" | "brown",
  seed: number,
  at: number,
  dur: number,
  vol: number,
  o: Partial<Layer> = {},
): Layer => ({ kind: "noise", color, seed, at, dur, vol, ...o }) as Layer;

/** count：音程が少しずつ上がる 14 回の小さな刻み（数え上げの間じゅう鳴る） */
const countTicks = Array.from({ length: 14 }, (_, i) =>
  tone(900 + i * 70, i * 0.11, 0.045, 0.5, { attack: 0.001 }),
);

export const RECIPES: Recipe[] = [
  {
    name: "message",
    trimDb: -2.5,
    desc: "メッセージの着信（短い 2 音）",
    dur: 0.5,
    layers: [
      tone(880, 0, 0.16, 0.5, { attack: 0.005 }),
      tone(1174.7, 0.12, 0.36, 0.5, { attack: 0.005 }),
      tone(2349.3, 0.12, 0.2, 0.1, { attack: 0.005 }),
    ],
  },
  {
    name: "wall-up",
    trimDb: -8.2,
    desc: "壁が立つ低い音",
    dur: 0.8,
    layers: [
      sweep(80, 130, 0, 0.55, 0.7, { attack: 0.02 }),
      tone(190, 0, 0.5, 0.25, { attack: 0.02 }),
      noise("brown", 11, 0, 0.35, 0.9, { attack: 0.01, fx: "lowpass=f=500" }),
    ],
  },
  {
    name: "wall-down",
    trimDb: -4.5,
    desc: "壁が崩れる音",
    dur: 1.6,
    layers: [
      noise("pink", 21, 0, 1.4, 0.7, { attack: 0.03, fx: "highpass=f=80,lowpass=f=1200" }),
      sweep(170, 50, 0, 1.2, 0.5, { attack: 0.02 }),
      noise("white", 22, 0.15, 0.04, 0.25, { fx: "highpass=f=3000" }),
      noise("white", 23, 0.3, 0.04, 0.2, { fx: "highpass=f=3000" }),
      noise("white", 24, 0.55, 0.04, 0.18, { fx: "highpass=f=3000" }),
      noise("white", 25, 0.8, 0.04, 0.12, { fx: "highpass=f=3000" }),
    ],
  },
  {
    name: "tick",
    trimDb: -3.5,
    desc: "外部確認の結果が出るたびの小さな音",
    dur: 0.1,
    layers: [
      tone(1760, 0, 0.09, 0.5, { attack: 0.002 }),
      tone(2637, 0, 0.06, 0.15, { attack: 0.002 }),
    ],
  },
  {
    name: "scan",
    trimDb: -1,
    desc: "赤い線が進む間の細い走査音（くり返して使う）",
    dur: 1.0,
    layers: [
      sweep(700, 1500, 0, 1.0, 0.45, { attack: 0.2, release: 0.4, fx: "tremolo=f=18:d=0.5" }),
    ],
  },
  {
    name: "flip",
    trimDb: -1.5,
    desc: "黄 → 赤の切り替えの短い音",
    dur: 0.4,
    layers: [
      noise("white", 31, 0, 0.02, 0.15, { fx: "highpass=f=2000" }),
      tone(523.3, 0, 0.12, 0.4, { attack: 0.003 }),
      tone(784, 0.1, 0.14, 0.4, { attack: 0.003 }),
      tone(1174.7, 0.2, 0.2, 0.45, { attack: 0.003 }),
    ],
  },
  {
    name: "verify",
    trimDb: 4,
    desc: "検証が通る小さな音",
    dur: 0.5,
    layers: [
      tone(1568, 0, 0.3, 0.5, { attack: 0.003 }),
      tone(2093, 0.06, 0.25, 0.25, { attack: 0.003 }),
    ],
    echo: "0.8:0.5:90:0.35",
  },
  {
    name: "count",
    trimDb: -1.5,
    desc: "数え上げのカウント音（音程が上がる 14 回の刻み）",
    dur: 1.6,
    layers: countTicks,
  },
  {
    name: "impact",
    trimDb: -6.5,
    desc: "結論の低い一打",
    dur: 2.0,
    layers: [
      sweep(120, 42, 0, 0.5, 0.9, { attack: 0.003 }),
      tone(55, 0, 1.6, 0.6, { attack: 0.003 }),
      noise("brown", 41, 0, 0.5, 0.9, { attack: 0.002, fx: "lowpass=f=300" }),
      tone(220, 0, 0.25, 0.2, { attack: 0.002 }),
    ],
    echo: "0.9:0.55:180|360:0.4|0.25",
  },
  {
    name: "shield-bounce",
    trimDb: -5.5,
    desc: "盾が弾かれる金属的な音",
    dur: 0.7,
    layers: [
      tone(1320, 0, 0.5, 0.35, { attack: 0.002 }),
      tone(1980, 0, 0.4, 0.2, { attack: 0.002 }),
      tone(2772, 0, 0.3, 0.12, { attack: 0.002 }),
      noise("white", 51, 0, 0.03, 0.3, { fx: "highpass=f=4000" }),
      sweep(900, 400, 0.05, 0.25, 0.2, { attack: 0.005 }),
    ],
  },
  {
    name: "green-spread",
    trimDb: 4.5,
    desc: "緑が広がる音（上がっていく 4 音と、ふくらむ空気）",
    dur: 1.4,
    layers: [
      tone(523.3, 0, 0.7, 0.35, { attack: 0.08 }),
      tone(659.3, 0.15, 0.7, 0.35, { attack: 0.08 }),
      tone(784, 0.3, 0.7, 0.35, { attack: 0.08 }),
      tone(1046.5, 0.45, 0.8, 0.35, { attack: 0.08 }),
      noise("pink", 61, 0, 1.0, 0.1, { attack: 0.5, fx: "highpass=f=2000" }),
    ],
    echo: "0.8:0.5:160|320:0.35|0.2",
  },
];

export function getRecipe(name: SoundName): Recipe {
  const r = RECIPES.find((x) => x.name === name);
  if (!r) throw new Error(`未定義の効果音です：${name}`);
  return r;
}

const num = (n: number) => String(Number(n.toFixed(6)));

function layerChain(l: Layer, i: number): string {
  const rate = SAMPLE_RATE;
  const attack = l.attack ?? 0.003;
  const release = Math.min(l.release ?? l.dur - attack, l.dur - attack);
  let src: string;
  if (l.kind === "tone") {
    src = `sine=frequency=${num(l.f)}:sample_rate=${rate}:duration=${num(l.dur)}`;
  } else if (l.kind === "sweep") {
    const k = (l.f1 - l.f0) / (2 * l.dur);
    src = `aevalsrc=exprs='sin(2*PI*(${num(l.f0)}*t+${num(k)}*t*t))':sample_rate=${rate}:duration=${num(l.dur)}`;
  } else {
    src = `anoisesrc=color=${l.color}:seed=${l.seed}:sample_rate=${rate}:duration=${num(l.dur)}:amplitude=1`;
  }
  const f = [
    src,
    `afade=t=in:st=0:d=${num(attack)}`,
    `afade=t=out:st=${num(l.dur - release)}:d=${num(release)}:curve=qua`,
    l.fx,
    `volume=${num(l.kind === "tone" ? l.vol * 8 : l.vol)}`, // sine ソースの振幅は 1/8 なので 8 倍して揃える
    `aformat=sample_fmts=fltp:sample_rates=${rate}:channel_layouts=mono`,
  ];
  if (l.at > 0) f.push(`adelay=${Math.round(l.at * rate)}S:all=1`);
  return `${f.filter(Boolean).join(",")}[l${i}]`;
}

/** ffmpeg に渡す filter_complex（出力ラベルは [out]）。ピークは PEAK_LIMIT 以下に抑える */
export function buildFilterComplex(r: Recipe): string {
  const parts = r.layers.map((l, i) => layerChain(l, i));
  const labels = r.layers.map((_, i) => `[l${i}]`).join("");
  const tail = [
    `apad=whole_dur=${num(r.dur)}`,
    ...(r.echo ? [`aecho=${r.echo}`] : []),
    `volume=${num(r.trimDb)}dB`,
    `atrim=0:${num(r.dur)}`,
    `afade=t=out:st=${num(r.dur - 0.03)}:d=0.03`,
    `alimiter=limit=${PEAK_LIMIT}:attack=0.1:release=10:level=disabled`,
  ].join(",");
  const mix =
    r.layers.length > 1
      ? `${labels}amix=inputs=${r.layers.length}:normalize=0:duration=longest,${tail}[out]`
      : `${labels}${tail}[out]`;
  return [...parts, mix].join(";");
}

/** 1 つの効果音を WAV にする ffmpeg の引数（先頭の -hide_banner などは呼び出し側） */
export function buildSynthArgs(r: Recipe, outPath: string): string[] {
  return [
    "-filter_complex",
    buildFilterComplex(r),
    "-map",
    "[out]",
    "-ar",
    String(SAMPLE_RATE),
    "-ac",
    "1",
    "-c:a",
    "pcm_s16le",
    "-fflags",
    "+bitexact",
    "-flags:a",
    "+bitexact",
    "-map_metadata",
    "-1",
    "-t",
    num(r.dur),
    outPath,
  ];
}
