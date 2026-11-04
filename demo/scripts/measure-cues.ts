/**
 * 字幕の各行が始まる時刻を、音声合成の長さから測って demo/narration.json の cueStarts に書く。
 *   node demo/scripts/measure-cues.ts [--host http://localhost:50021] [--name 四国めたん] [--style ノーマル] [--dry-run]
 * なぜ要るか：字幕を文字数に比例して配ると、読み上げの速さが文ごとに違うぶん、字幕が数秒ずれる（特に場面の終わりに余白があるとき）。
 * ここでは、読み上げ用の文（textJa）を「。」で区切り、先頭からその文までを実際に合成して長さを測る。
 * 字幕の各行は、文字数の割合がいちばん近い「。」の位置に対応づける。読み上げの速さ（speechSpeed）と先頭の無音（leadSilenceSeconds）は、音声を作るときと同じにする。
 * VOICEVOX エンジンが要る（synth-voicevox.ts と同じ）。音声ファイルは作らない。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { demoRoot, type Narration, wavDurationSeconds } from "./lib.ts";

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
}
const host = (arg("host", "http://localhost:50021") ?? "").replace(/\/$/, "");
const wantName = arg("name", "四国めたん") ?? "四国めたん";
const wantStyle = arg("style", "ノーマル") ?? "ノーマル";
const dryRun = process.argv.includes("--dry-run");

type Speaker = { name: string; styles: { name: string; id: number }[] };
const sp = (await (await fetch(`${host}/speakers`)).json()) as Speaker[];
const style = sp.find((s) => s.name === wantName)?.styles.find((x) => x.name === wantStyle);
if (!style) {
  console.error(`話者 ${wantName}（${wantStyle}）が見つかりません。`);
  process.exit(2);
}
const speaker = style.id;

const path = join(demoRoot, "narration.json");
const narration = JSON.parse(readFileSync(path, "utf8")) as Narration;

async function speechSeconds(text: string, speed: number, lead: number): Promise<number> {
  const q = await fetch(
    `${host}/audio_query?${new URLSearchParams({ text, speaker: String(speaker) })}`,
    { method: "POST" },
  );
  const query = (await q.json()) as Record<string, unknown>;
  query.speedScale = speed;
  query.outputSamplingRate = 48000;
  if (lead) query.prePhonemeLength = lead;
  const s = await fetch(`${host}/synthesis?${new URLSearchParams({ speaker: String(speaker) })}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "audio/wav" },
    body: JSON.stringify(query),
  });
  return wavDurationSeconds(Buffer.from(await s.arrayBuffer()));
}

for (const scene of narration.scenes) {
  const text = scene.textJa;
  const speed = scene.speechSpeed ?? 1;
  const lead = scene.leadSilenceSeconds ?? 0;
  // 「。」のあとの位置（最後の文の終わりは除く）
  const bounds: number[] = [];
  for (let i = 0; i < text.length - 1; i++) if (text[i] === "。") bounds.push(i + 1);
  const lines = scene.subtitleJa;
  const total = lines.reduce((n, l) => n + l.length, 0) || 1;
  const starts: number[] = [lead];
  let acc = 0;
  let prev = 0;
  for (let k = 0; k < lines.length - 1; k++) {
    acc += (lines[k] ?? "").length;
    const frac = acc / total;
    // 文字数の割合がいちばん近い境界（すでに使った境界より後ろ）
    let best = -1;
    let bestD = Number.POSITIVE_INFINITY;
    for (const b of bounds) {
      if (b <= prev) continue;
      const d = Math.abs(b / text.length - frac);
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    if (best < 0) {
      // 境界が足りないときは、読み上げ全体を文字数で配る
      starts.push(-1);
      continue;
    }
    prev = best;
    starts.push(await speechSeconds(text.slice(0, best), speed, lead));
  }
  // 境界が足りなかった行は、前後の測った時刻の間を等分する
  const full = await speechSeconds(text, speed, lead);
  for (let k = 1; k < starts.length; k++) {
    if ((starts[k] ?? 0) >= 0) continue;
    const a = k - 1;
    let b = k;
    while ((starts[b] ?? 0) < 0 && b < starts.length) b++;
    const from = starts[a] ?? lead;
    const to = b < starts.length ? (starts[b] ?? full) : full;
    const n = b - a;
    for (let j = 1; j < n; j++) starts[a + j] = from + ((to - from) * j) / n;
    k = b;
  }
  scene.cueStarts = starts.map((v) => Math.round(v * 100) / 100);
  console.log(
    `場面 ${scene.n}：${scene.cueStarts.map((v) => v.toFixed(1)).join(" / ")}（読み上げ ${full.toFixed(1)} 秒）`,
  );
}
if (!dryRun) {
  writeFileSync(path, `${JSON.stringify(narration, null, 2)}\n`);
  console.log(`書きました：${path}（pnpm lint:fix で整形してください）`);
}
