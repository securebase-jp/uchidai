/**
 * 録画（デモモードの画面収録 MP4/MOV）と音声、効果音、字幕、タイトルカードを ffmpeg で結合して 1 本の MP4 にする。
 *   node demo/scripts/assemble.ts --video demo/capture/screen.mov [--out demo/out/uchidai-demo.mp4]
 *        [--title demo/assets/title.png] [--title-seconds 3] [--font "BIZ UDPGothic"] [--no-subtitles] [--no-audio]
 *        [--no-sfx] [--sfx-gain -14] [--sfx demo/sfx.json] [--sfx-dir demo/audio/sfx]
 *        [--timeline demo/out/timeline.json] [--work-dir demo/out] [--fps 60] [--dry-run]
 * 手順：
 *   1. build-subtitles.ts で demo/out/narration.srt と timeline.json を作る（音声があれば長さを反映）
 *   2. 場面ごとの音声を場面の長さにそろえて 1 本の WAV にする（無い場面は無音）
 *   3. 効果音（demo/sfx.json の cue を場面の開始時刻から絶対時刻にして並べたトラック）をナレーションとミックス。
 *      効果音は --sfx-gain（既定 -14 dB）だけ小さくし、ナレーションの発話中はさらに自動で下げる（ダッキング）
 *   4. 録画 + 音声 + 字幕（+ タイトルカード）→ 1920×1080・60fps・H.264/AAC
 * --timeline を渡すと、原稿から計算せずにその timeline.json の場面の時刻を使う。
 * エンドカードはデモモードの最後の場面として録画に含まれる。
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import {
  audioDir,
  buildTimeline,
  loadDurations,
  loadNarration,
  outDir,
  type TimelineScene,
} from "./lib.ts";
import {
  buildMixArgs,
  buildSfxTrackArgs,
  DEFAULT_SFX_GAIN_DB,
  loadSfx,
  resolveCues,
  sfxJsonPath,
} from "./sfx-lib.ts";

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0) return process.argv[i + 1] ?? fallback;
  return fallback;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const video = arg("video") ? resolve(arg("video") ?? "") : undefined;
const out = resolve(arg("out", join(outDir, "uchidai-demo.mp4")) ?? "");
const title = arg("title") ? resolve(arg("title") ?? "") : undefined;
const titleSeconds = Number(arg("title-seconds", "3"));
const font = arg("font", "BIZ UDPGothic") ?? "BIZ UDPGothic";
const fps = Number(arg("fps", "60"));
const dry = flag("dry-run");
const withSubs = !flag("no-subtitles");
const withAudio = !flag("no-audio");
const withSfx = withAudio && !flag("no-sfx");
const sfxGainDb = Number(arg("sfx-gain", String(DEFAULT_SFX_GAIN_DB)));
const sfxPath = resolve(arg("sfx", sfxJsonPath) ?? "");
const sfxDir = resolve(arg("sfx-dir", join(audioDir, "sfx")) ?? "");
const timelinePath = arg("timeline") ? resolve(arg("timeline") ?? "") : undefined;
const workDir = resolve(arg("work-dir", outDir) ?? "");

if (!video || !existsSync(video)) {
  console.error(
    "録画ファイルを --video で指定してください（デモモード ?demo=1 を 1920×1080・60fps で画面収録したもの）",
  );
  process.exit(2);
}
if (spawnSync("ffmpeg", ["-version"]).status !== 0) {
  console.error("ffmpeg が見つかりません：brew install ffmpeg");
  process.exit(2);
}
if (!Number.isFinite(sfxGainDb)) {
  console.error("--sfx-gain には dB の数値を渡してください（例：-14）");
  process.exit(2);
}
mkdirSync(workDir, { recursive: true });
// 字幕の焼き込みには libass つきの ffmpeg（subtitles フィルタ）が要る。無ければ字幕トラックとして埋め込む
const hasSubtitlesFilter = /\bsubtitles\b/.test(
  spawnSync("ffmpeg", ["-hide_banner", "-filters"], { encoding: "utf8" }).stdout ?? "",
);
const burnSubs = withSubs && hasSubtitlesFilter;
const softSubs = withSubs && !hasSubtitlesFilter;
if (softSubs)
  console.warn(
    "注意：この ffmpeg には subtitles フィルタ（libass）が無いため、字幕は焼き込まず mov_text の字幕トラックとして埋め込みます。\n" +
      "焼き込みたいときは、libass つきの ffmpeg を使うか、録画時に ?demo=1&captions=1 で画面に字幕を出してください。YouTube には narration.srt を別途アップロードできます。",
  );

const run = (args: string[]) => {
  console.log(
    `$ ffmpeg ${args.map((a) => (/[\s'"[\]]/.test(a) ? JSON.stringify(a) : a)).join(" ")}`,
  );
  if (!dry)
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], {
      stdio: "inherit",
    });
};

// 1. タイムライン（build-subtitles.ts と同じ計算）
function loadTimelineFile(path: string): TimelineScene[] {
  const raw = JSON.parse(readFileSync(path, "utf8")) as { scenes?: TimelineScene[] };
  if (!Array.isArray(raw.scenes) || raw.scenes.length === 0) {
    console.error(`${path} に scenes がありません`);
    process.exit(2);
  }
  for (const s of raw.scenes)
    if (
      ![s.n, s.start, s.end, s.seconds].every((v) => typeof v === "number" && Number.isFinite(v))
    ) {
      console.error(`${path} の場面の形が不正です：${JSON.stringify(s).slice(0, 120)}`);
      process.exit(2);
    }
  return raw.scenes;
}
const timeline = timelinePath
  ? loadTimelineFile(timelinePath)
  : buildTimeline(loadNarration(), loadDurations());
const total = timeline[timeline.length - 1]?.end ?? 0;
const srt = join(workDir, "narration.srt");
if (withSubs && !existsSync(srt)) {
  console.error(
    `字幕 ${srt} がありません。先に node demo/scripts/build-subtitles.ts を実行してください`,
  );
  process.exit(2);
}

// 2. 音声：場面ごとに長さをそろえて連結
let narrationWav: string | undefined;
if (withAudio) {
  const parts: string[] = [];
  for (const s of timeline) {
    const part = join(workDir, `part-${s.n}.wav`);
    if (s.audio) {
      run([
        "-i",
        s.audio,
        "-af",
        `aresample=48000,apad=whole_dur=${s.seconds},atrim=0:${s.seconds}`,
        "-ac",
        "1",
        part,
      ]);
    } else {
      run(["-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono", "-t", String(s.seconds), part]);
    }
    parts.push(part);
  }
  const list = join(workDir, "parts.txt");
  writeFileSync(list, `${parts.map((p) => `file '${basename(p)}'`).join("\n")}\n`);
  narrationWav = join(workDir, "narration.wav");
  run(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", narrationWav]);
  if (timeline.every((s) => !s.audio))
    console.warn(
      "注意：音声ファイルが一つもないので、無音のトラックを付けます（synth-voicevox.ts で作れます）",
    );
}

// 2b. 効果音：cue を絶対時刻に並べたトラックを作り、ナレーションとミックスする（発話中は自動で下げる）
let audioWav = narrationWav;
if (withSfx && narrationWav) {
  const sfx = loadSfx(sfxPath);
  const { resolved, skipped, warnings } = resolveCues(sfx.cues, timeline);
  for (const k of skipped)
    console.warn(`効果音を飛ばします：${k.cue.sound}（場面 ${k.cue.scene}）— ${k.reason}`);
  for (const w of warnings) console.warn(`注意：${w}`);
  // 音が作られていない cue は飛ばす（--dry-run のときは全部並べてコマンドを見せる）
  const missing = [...new Set(resolved.map((r) => r.cue.sound))].filter(
    (name) => !existsSync(join(sfxDir, `${name}.wav`)),
  );
  const playable = dry ? resolved : resolved.filter((r) => !missing.includes(r.cue.sound));
  if (!dry && missing.length)
    console.warn(
      `注意：効果音の WAV がありません（${missing.join(", ")}）。node demo/scripts/synth-sfx.ts で作ってください。その cue は飛ばします`,
    );
  if (playable.length > 0) {
    const sfxTrack = join(workDir, "sfx-track.wav");
    run(buildSfxTrackArgs({ cues: playable, sfxDir, totalSeconds: total, out: sfxTrack }));
    audioWav = join(workDir, "audio-mix.wav");
    run(buildMixArgs({ narration: narrationWav, sfxTrack, sfxGainDb, out: audioWav }));
    console.log(
      `効果音：${playable.length} 件（${sfxGainDb} dB、ナレーションの発話中はさらに下げる）`,
    );
  } else {
    console.warn("注意：鳴らす効果音がないので、ナレーションだけにします");
  }
}

// 3. 結合
const inputs: string[] = [];
let vIndex = 0;
if (title) {
  if (!existsSync(title)) {
    console.error(`タイトルカード ${title} がありません`);
    process.exit(2);
  }
  inputs.push("-loop", "1", "-t", String(titleSeconds), "-i", title);
  vIndex = 1;
}
inputs.push("-i", video);
const aIndex = vIndex + 1;
if (audioWav) inputs.push("-i", audioWav);
const sIndex = audioWav ? aIndex + 1 : aIndex;
if (softSubs) inputs.push("-i", srt);

const filters: string[] = [];
const subFilter = burnSubs
  ? `,subtitles=${basename(srt)}:force_style='FontName=${font},FontSize=20,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=2,Shadow=0,MarginV=36'`
  : "";
filters.push(
  `[${vIndex}:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},format=yuv420p${subFilter}[main]`,
);
let vOut = "[main]";
let aOut = audioWav ? `${aIndex}:a` : "";
if (title) {
  filters.push(
    `[0:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},format=yuv420p[tv]`,
  );
  filters.push("[tv][main]concat=n=2:v=1:a=0[vcat]");
  vOut = "[vcat]";
  if (audioWav) {
    filters.push(`[${aIndex}:a]adelay=${Math.round(titleSeconds * 1000)}:all=1[acat]`);
    aOut = "[acat]";
  }
}
const args = [
  ...inputs,
  "-filter_complex",
  filters.join(";"),
  "-map",
  vOut,
  ...(aOut ? ["-map", aOut] : []),
  "-c:v",
  "libx264",
  "-preset",
  "medium",
  "-crf",
  "18",
  "-r",
  String(fps),
  "-pix_fmt",
  "yuv420p",
  ...(aOut ? ["-c:a", "aac", "-b:a", "192k"] : ["-an"]),
  ...(softSubs
    ? ["-map", `${sIndex}:s`, "-c:s", "mov_text", "-metadata:s:s:0", "language=jpn"]
    : []),
  "-movflags",
  "+faststart",
  "-shortest",
  out,
];
const cwd = process.cwd();
try {
  process.chdir(workDir); // subtitles フィルタにパスの特殊文字を渡さないため
  run(args);
} finally {
  process.chdir(cwd);
}
console.log(
  `\n出力：${out}（原稿の合計 ${total.toFixed(1)} 秒${title ? ` + タイトル ${titleSeconds} 秒` : ""}）`,
);
if (!dry) {
  const probe = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration:stream=width,height,r_frame_rate,codec_name",
      "-of",
      "default=nw=1",
      out,
    ],
    { encoding: "utf8" },
  );
  console.log(probe.stdout.trim());
}
