/**
 * 効果音の cue（demo/sfx.json）の読み込みと検証、場面の時刻から絶対時刻への変換、
 * 効果音トラックの作成とナレーションとのミックス（ダッキング）の ffmpeg 引数の組み立て。
 * ffmpeg は呼ばない（assemble.ts が実行する）ので、テストから引数だけを確かめられる。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { demoRoot } from "./lib.ts";
import { SAMPLE_RATE, SOUND_NAMES } from "./sfx-sounds.ts";

export const sfxJsonPath = join(demoRoot, "sfx.json");

export const SfxCue = z.object({
  /** 脚本 v2 の場面の番号 n（主キー）。narration.json の場面の n と合わせる */
  scene: z.number().int().min(1),
  /** 場面の名前（参考。照合には使わない） */
  label: z.string().optional(),
  /** 秒。anchor が "start"（既定）なら場面の開始から、"end" なら場面の終わりの何秒前か */
  at: z.number().min(0),
  anchor: z.enum(["start", "end"]).optional(),
  sound: z.enum(SOUND_NAMES),
  /** 0〜1。音ごとの基準の音量に対する割合 */
  gain: z.number().min(0).max(1),
  note: z.string().optional(),
});
export type SfxCue = z.infer<typeof SfxCue>;

export const SfxFile = z.object({
  version: z.literal(1),
  note: z.string().optional(),
  cues: z.array(SfxCue).min(1),
});
export type SfxFile = z.infer<typeof SfxFile>;

export function parseSfx(raw: unknown): SfxFile {
  return SfxFile.parse(raw);
}

export function loadSfx(path = sfxJsonPath): SfxFile {
  return parseSfx(JSON.parse(readFileSync(path, "utf8")));
}

export type SceneTime = { n: number; start: number; end: number };
export type ResolvedCue = { cue: SfxCue; scene: number; abs: number };
export type Resolution = {
  resolved: ResolvedCue[];
  /** 場面が無い、または時刻が動画の外になる cue（鳴らさない） */
  skipped: { cue: SfxCue; reason: string }[];
  /** 鳴らすが気をつけたい cue（場面の長さを超える） */
  warnings: string[];
};

/** cue の場面内の時刻を、動画（タイムライン）の絶対時刻に直す。結果は絶対時刻の昇順 */
export function resolveCues(cues: SfxCue[], scenes: SceneTime[]): Resolution {
  const out: Resolution = { resolved: [], skipped: [], warnings: [] };
  for (const cue of cues) {
    const sc = scenes.find((s) => s.n === cue.scene);
    if (!sc) {
      out.skipped.push({ cue, reason: `場面 ${cue.scene} がタイムラインにありません` });
      continue;
    }
    const abs = cue.anchor === "end" ? sc.end - cue.at : sc.start + cue.at;
    if (abs < 0 || abs < sc.start - 1e-9) {
      out.skipped.push({
        cue,
        reason: `場面 ${cue.scene} の開始より前になります（${abs.toFixed(2)} 秒）`,
      });
      continue;
    }
    if (abs > sc.end + 1e-9)
      out.warnings.push(
        `場面 ${cue.scene} の ${cue.sound}（at ${cue.at}）は場面の終わり（${(sc.end - sc.start).toFixed(1)} 秒）を超え、次の場面にかかります`,
      );
    out.resolved.push({ cue, scene: cue.scene, abs });
  }
  out.resolved.sort((a, b) => a.abs - b.abs);
  return out;
}

const num = (n: number) => String(Number(n.toFixed(6)));

/**
 * 効果音を絶対時刻に並べたトラック（モノラル 48 kHz）を作る ffmpeg の引数。
 * 音ごとに 1 入力（<sfxDir>/<名前>.wav）。重なって鳴ってもあふれないよう最後に alimiter を通す。
 */
export function buildSfxTrackArgs(opts: {
  cues: ResolvedCue[];
  sfxDir: string;
  totalSeconds: number;
  out: string;
}): string[] {
  const { cues, sfxDir, totalSeconds, out } = opts;
  if (cues.length === 0) throw new Error("鳴らす cue がありません");
  const sounds = [...new Set(cues.map((c) => c.cue.sound))];
  const args: string[] = [];
  for (const s of sounds) args.push("-i", join(sfxDir, `${s}.wav`));
  const uses = new Map<string, number>();
  const filters: string[] = [];
  for (const [si, s] of sounds.entries()) {
    const k = cues.filter((c) => c.cue.sound === s).length;
    const outs = Array.from({ length: k }, (_, j) => `[${si}_${j}]`).join("");
    filters.push(`[${si}:a]asplit=${k}${outs}`);
  }
  const labels: string[] = [];
  for (const [ci, c] of cues.entries()) {
    const si = sounds.indexOf(c.cue.sound);
    const j = uses.get(c.cue.sound) ?? 0;
    uses.set(c.cue.sound, j + 1);
    const delay = Math.round(c.abs * SAMPLE_RATE);
    filters.push(`[${si}_${j}]volume=${num(c.cue.gain)},adelay=${delay}S:all=1[c${ci}]`);
    labels.push(`[c${ci}]`);
  }
  const mix =
    cues.length > 1
      ? `${labels.join("")}amix=inputs=${cues.length}:normalize=0:duration=longest`
      : `${labels.join("")}anull`;
  filters.push(
    `${mix},apad=whole_dur=${num(totalSeconds)},atrim=0:${num(totalSeconds)},alimiter=limit=0.9:level=disabled[sfx]`,
  );
  return [
    ...args,
    "-filter_complex",
    filters.join(";"),
    "-map",
    "[sfx]",
    "-ar",
    String(SAMPLE_RATE),
    "-ac",
    "1",
    "-c:a",
    "pcm_s16le",
    out,
  ];
}

/** ダッキング（ナレーションの発話中に効果音を下げる）の設定。sidechaincompress の引数 */
export type Duck = {
  /** ナレーションがこの線形の大きさを超えると下げ始める */
  threshold: number;
  ratio: number;
  /** ms */
  attack: number;
  /** ms。発話が終わってから効果音が戻るまで */
  release: number;
};
export const DEFAULT_DUCK: Duck = { threshold: 0.02, ratio: 20, attack: 10, release: 400 };
/** 効果音をナレーションに対して下げる量の既定（dB） */
export const DEFAULT_SFX_GAIN_DB = -14;

/**
 * ナレーション（あれば）と効果音トラックをミックスする ffmpeg の引数。
 * 効果音は sfxGainDb だけ下げ、ナレーションをサイドチェーンにして発話中はさらに下げる。
 * ナレーションが無ければ効果音だけを同じ音量で出す。
 */
export function buildMixArgs(opts: {
  narration?: string | undefined;
  sfxTrack: string;
  sfxGainDb: number;
  out: string;
  duck?: Duck;
}): string[] {
  const { narration, sfxTrack, sfxGainDb, out } = opts;
  const d = opts.duck ?? DEFAULT_DUCK;
  const limiter = "alimiter=limit=0.95:level=disabled";
  // 仕上げ：動画サイトで小さく聞こえないよう、全体の音量を -16 LUFS（ピーク -1.5 dB）にそろえる
  const loudness = "loudnorm=I=-16:TP=-1.5:LRA=11";
  const tail = ["-ar", String(SAMPLE_RATE), "-ac", "1", "-c:a", "pcm_s16le", out];
  if (!narration) {
    return [
      "-i",
      sfxTrack,
      "-filter_complex",
      `[0:a]volume=${num(sfxGainDb)}dB,${limiter},${loudness}[mix]`,
      "-map",
      "[mix]",
      ...tail,
    ];
  }
  const filter = [
    "[0:a]asplit=2[nar][key]",
    `[1:a]volume=${num(sfxGainDb)}dB[sfxg]`,
    `[sfxg][key]sidechaincompress=threshold=${num(d.threshold)}:ratio=${num(d.ratio)}:attack=${num(d.attack)}:release=${num(d.release)}:makeup=1[duck]`,
    "[nar][duck]amix=inputs=2:normalize=0:duration=first[m]",
    `[m]${limiter},${loudness}[mix]`,
  ].join(";");
  return ["-i", narration, "-i", sfxTrack, "-filter_complex", filter, "-map", "[mix]", ...tail];
}
