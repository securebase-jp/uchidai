/**
 * 効果音（自作の合成音）を ffmpeg の lavfi だけで作り、demo/audio/sfx/<名前>.wav に書く（git 管理外）。
 * 外部の音素材・ダウンロードは使わない。何度作っても同じ WAV になる（決定的）。
 *   node demo/scripts/synth-sfx.ts [--only tick,impact] [--out-dir demo/audio/sfx] [--list] [--dry-run]
 * 音の一覧とレシピは sfx-sounds.ts、cue（いつ鳴らすか）は demo/sfx.json、説明は demo/sfx.md。
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { audioDir } from "./lib.ts";
import { buildSynthArgs, PEAK_LIMIT, RECIPES, SOUND_NAMES, type SoundName } from "./sfx-sounds.ts";

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0) return process.argv[i + 1] ?? fallback;
  return fallback;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

if (flag("list")) {
  for (const r of RECIPES) console.log(`${r.name.padEnd(14)}${r.dur.toFixed(2)} 秒  ${r.desc}`);
  console.log(`\nピークは ${(20 * Math.log10(PEAK_LIMIT)).toFixed(1)} dBFS 以下に抑えます`);
  process.exit(0);
}

const outDir = resolve(arg("out-dir", join(audioDir, "sfx")) ?? "");
const dry = flag("dry-run");

const only = arg("only")
  ?.split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const unknown = (only ?? []).filter((n) => !(SOUND_NAMES as readonly string[]).includes(n));
if (unknown.length) {
  console.error(`未定義の効果音です：${unknown.join(", ")}（--list で一覧）`);
  process.exit(2);
}
const targets = RECIPES.filter((r) => !only || only.includes(r.name));

if (!dry && spawnSync("ffmpeg", ["-version"]).status !== 0) {
  console.error("ffmpeg が見つかりません：brew install ffmpeg");
  process.exit(2);
}
if (!dry) mkdirSync(outDir, { recursive: true });

for (const r of targets) {
  const out = join(outDir, `${r.name satisfies SoundName}.wav`);
  const args = ["-hide_banner", "-loglevel", "error", "-y", ...buildSynthArgs(r, out)];
  if (dry) {
    console.log(
      `$ ffmpeg ${args.map((a) => (/[\s'"[\]|]/.test(a) ? JSON.stringify(a) : a)).join(" ")}`,
    );
    continue;
  }
  execFileSync("ffmpeg", args, { stdio: "inherit" });
  console.log(`${r.name.padEnd(14)}${r.dur.toFixed(2)} 秒  → ${out}`);
}
if (!dry) console.log(`\n${targets.length} 件を書き出しました：${outDir}`);
