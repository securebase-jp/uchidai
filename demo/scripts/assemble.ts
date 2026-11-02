/**
 * 録画（デモモードの画面収録 MP4/MOV）と音声、字幕、タイトルカードを ffmpeg で結合して 1 本の MP4 にする。
 *   node demo/scripts/assemble.ts --video demo/capture/screen.mov [--out demo/out/uchidai-demo.mp4]
 *        [--title demo/assets/title.png] [--title-seconds 3] [--font "BIZ UDPGothic"] [--no-subtitles] [--no-audio]
 *        [--fps 60] [--dry-run]
 * 手順：
 *   1. build-subtitles.ts で demo/out/narration.srt と timeline.json を作る（音声があれば長さを反映）
 *   2. 場面ごとの音声を場面の長さにそろえて 1 本の WAV にする（無い場面は無音）
 *   3. 録画 + 音声 + 字幕の焼き込み（+ タイトルカード）→ 1920×1080・60fps・H.264/AAC
 * エンドカードはデモモードの場面 9 として録画に含まれる。
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { buildTimeline, loadDurations, loadNarration, outDir } from "./lib.ts";

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
mkdirSync(outDir, { recursive: true });
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
const narration = loadNarration();
const timeline = buildTimeline(narration, loadDurations());
const total = timeline[timeline.length - 1]?.end ?? 0;
const srt = join(outDir, "narration.srt");
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
    const part = join(outDir, `part-${s.n}.wav`);
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
  const list = join(outDir, "parts.txt");
  writeFileSync(list, `${parts.map((p) => `file '${basename(p)}'`).join("\n")}\n`);
  narrationWav = join(outDir, "narration.wav");
  run(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", narrationWav]);
  if (timeline.every((s) => !s.audio))
    console.warn(
      "注意：音声ファイルが一つもないので、無音のトラックを付けます（synth-voicevox.ts で作れます）",
    );
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
if (narrationWav) inputs.push("-i", narrationWav);
const sIndex = narrationWav ? aIndex + 1 : aIndex;
if (softSubs) inputs.push("-i", srt);

const filters: string[] = [];
const subFilter = burnSubs
  ? `,subtitles=${basename(srt)}:force_style='FontName=${font},FontSize=20,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=2,Shadow=0,MarginV=36'`
  : "";
filters.push(
  `[${vIndex}:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},format=yuv420p${subFilter}[main]`,
);
let vOut = "[main]";
let aOut = narrationWav ? `${aIndex}:a` : "";
if (title) {
  filters.push(
    `[0:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},format=yuv420p[tv]`,
  );
  filters.push("[tv][main]concat=n=2:v=1:a=0[vcat]");
  vOut = "[vcat]";
  if (narrationWav) {
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
  process.chdir(outDir); // subtitles フィルタにパスの特殊文字を渡さないため
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
