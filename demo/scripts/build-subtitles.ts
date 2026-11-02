/**
 * 原稿（demo/narration.json）→ 字幕（SRT と VTT、YouTube 用）とタイムライン（demo/out/timeline.json）。
 * 各場面の長さは demo/audio/durations.json（音声の長さ）があればそれを、無ければ原稿の targetSeconds を使う。
 *   node demo/scripts/build-subtitles.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildTimeline,
  countChars,
  fmtSrt,
  fmtVtt,
  loadDurations,
  loadNarration,
  outDir,
} from "./lib.ts";

const narration = loadNarration();
const durations = loadDurations();
const timeline = buildTimeline(narration, durations);
mkdirSync(outDir, { recursive: true });

const cues = timeline.flatMap((s) => s.cues);
const srt = cues
  .map((c, i) => `${i + 1}\n${fmtSrt(c.start)} --> ${fmtSrt(c.end)}\n${c.text}\n`)
  .join("\n");
const vtt = `WEBVTT\n\n${cues
  .map((c, i) => `${i + 1}\n${fmtVtt(c.start)} --> ${fmtVtt(c.end)}\n${c.text}\n`)
  .join("\n")}`;
writeFileSync(join(outDir, "narration.srt"), srt);
writeFileSync(join(outDir, "narration.vtt"), vtt);
writeFileSync(
  join(outDir, "timeline.json"),
  `${JSON.stringify({ generatedAt: new Date().toISOString(), credits: narration.credits, scenes: timeline }, null, 2)}\n`,
);

const total = timeline[timeline.length - 1]?.end ?? 0;
const totalChars = narration.scenes.reduce((n, s) => n + countChars(s.textJa), 0);
console.log("| 場面 | 題 | 文字数 | 目安秒 | 長さ（秒） | 文字/秒 | 由来 |");
console.log("| ---- | -- | -----: | -----: | ---------: | ------: | ---- |");
for (const s of timeline) {
  const script = narration.scenes.find((x) => x.n === s.n);
  if (!script) continue;
  const chars = countChars(script.textJa);
  console.log(
    `| ${s.n} | ${s.titleJa} | ${chars} | ${script.targetSeconds} | ${s.seconds.toFixed(1)} | ${(chars / s.seconds).toFixed(1)} | ${s.fromAudio ? "音声" : "原稿"} |`,
  );
}
console.log(
  `| 合計 |  | ${totalChars} | ${narration.totalTargetSeconds} | ${total.toFixed(1)} | ${(totalChars / total).toFixed(1)} |  |`,
);
console.log(
  `\n書き出し：${join(outDir, "narration.srt")}、narration.vtt、timeline.json（cue ${cues.length} 件）`,
);
