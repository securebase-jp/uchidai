/**
 * demo/scripts の共通部分：原稿と絵コンテの読み込み、音声の長さ、タイムライン（場面の開始・終了秒）。
 * 依存なし（node の標準モジュールだけ）。node の型ストリップで直接実行する。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const demoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
export const repoRoot = join(demoRoot, "..");
export const audioDir = join(demoRoot, "audio");
export const outDir = join(demoRoot, "out");

export type NarrationScene = {
  n: number;
  id: string;
  titleJa: string;
  targetSeconds: number;
  /** 読み上げの前に置く無音（秒）。音声の先頭に入れる。字幕もその分あとから始める */
  leadSilenceSeconds?: number;
  /** この場面の読み上げの速さ（VOICEVOX の speedScale。既定 1）。場面の長さに収めるための微調整 */
  speechSpeed?: number;
  /** 字幕の各行が始まる時刻（場面の開始からの秒）。measure-cues.ts が、音声合成の長さから測って書く */
  cueStarts?: number[];
  textJa: string;
  subtitleJa: string[];
  onScreen?: string;
};
export type Narration = {
  version: number;
  totalTargetSeconds: number;
  credits: { voice: string; voiceNoteJa?: string; fonts: string; attack?: string; github: string };
  scenes: NarrationScene[];
};

function must(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

/** narration.json を読んで最低限の形を確かめる（zod に依存しない） */
export function loadNarration(): Narration {
  const raw = JSON.parse(readFileSync(join(demoRoot, "narration.json"), "utf8")) as Narration;
  must(Array.isArray(raw.scenes) && raw.scenes.length > 0, "narration.json に scenes がありません");
  for (const s of raw.scenes) {
    must(Number.isInteger(s.n) && s.n > 0, `場面番号が不正です：${JSON.stringify(s.n)}`);
    must(typeof s.textJa === "string" && s.textJa.length > 0, `場面 ${s.n} に textJa がありません`);
    must(
      Array.isArray(s.subtitleJa) && s.subtitleJa.length > 0,
      `場面 ${s.n} に subtitleJa がありません`,
    );
    must(s.targetSeconds > 0, `場面 ${s.n} の targetSeconds が不正です`);
    must(
      s.leadSilenceSeconds === undefined ||
        (s.leadSilenceSeconds >= 0 && s.leadSilenceSeconds < s.targetSeconds),
      `場面 ${s.n} の leadSilenceSeconds が不正です`,
    );
  }
  must(
    raw.credits?.voice && raw.credits?.github,
    "narration.json に credits（voice, github）が要ります",
  );
  return raw;
}

/** demo/audio/durations.json（synth-voicevox.ts が書く） */
export function loadDurations(): Record<string, number> {
  const p = join(audioDir, "durations.json");
  if (!existsSync(p)) return {};
  const raw = JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw)) if (typeof v === "number" && v > 0) out[k] = v;
  return out;
}

/** WAV（RIFF, PCM）の長さを秒で返す */
export function wavDurationSeconds(buf: Buffer): number {
  must(buf.length > 44 && buf.toString("ascii", 0, 4) === "RIFF", "WAV ではありません");
  let pos = 12;
  let byteRate = 0;
  while (pos + 8 <= buf.length) {
    const id = buf.toString("ascii", pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    if (id === "fmt ") byteRate = buf.readUInt32LE(pos + 16);
    if (id === "data") {
      must(byteRate > 0, "fmt チャンクが見つかりません");
      return size / byteRate;
    }
    pos += 8 + size + (size % 2);
  }
  throw new Error("data チャンクが見つかりません");
}

export type TimelineScene = {
  n: number;
  id: string;
  titleJa: string;
  start: number;
  end: number;
  seconds: number;
  fromAudio: boolean;
  audio?: string;
  cues: { start: number; end: number; text: string }[];
};

/** 場面の開始・終了秒と字幕 cue（文字数に比例して割る）。音声があればその長さ、無ければ原稿の秒数 */
export function buildTimeline(
  narration: Narration,
  durations: Record<string, number>,
): TimelineScene[] {
  let t = 0;
  return narration.scenes.map((s) => {
    const d = durations[String(s.n)];
    const seconds = d ?? s.targetSeconds;
    // 先頭の無音のあいだは字幕を出さない。測った時刻（cueStarts）があればそれを使い、無ければ読み上げの長さを文字数で配る
    const lead = Math.min(s.leadSilenceSeconds ?? 0, seconds);
    const spoken = seconds - lead;
    const total = s.subtitleJa.reduce((n, c) => n + c.length, 0) || 1;
    const measured =
      s.cueStarts && s.cueStarts.length === s.subtitleJa.length ? s.cueStarts : undefined;
    let acc = 0;
    const cues = s.subtitleJa.map((text, i) => {
      if (measured) {
        const from = Math.min(measured[i] ?? 0, seconds);
        const to = Math.min(measured[i + 1] ?? seconds, seconds);
        return { start: t + from, end: t + to, text };
      }
      const start = t + lead + (spoken * acc) / total;
      acc += text.length;
      const end = t + lead + (spoken * acc) / total;
      return { start, end, text };
    });
    const scene: TimelineScene = {
      n: s.n,
      id: s.id,
      titleJa: s.titleJa,
      start: t,
      end: t + seconds,
      seconds,
      fromAudio: d !== undefined,
      cues,
    };
    const wav = join(audioDir, `${s.n}.wav`);
    if (existsSync(wav)) scene.audio = wav;
    t += seconds;
    return scene;
  });
}

export function fmtSrt(sec: number): string {
  const ms = Math.round(sec * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const r = ms % 1000;
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(r, 3)}`;
}
export const fmtVtt = (sec: number) => fmtSrt(sec).replace(",", ".");

/** 読み上げ文の文字数（空白と記号を除く） */
export function countChars(text: string): number {
  return text.replace(/[\s「」『』、。・！？!?（）()：:…—]/g, "").length;
}
