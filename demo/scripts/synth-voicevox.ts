/**
 * VOICEVOX エンジン（ローカル、既定 http://localhost:50021）で場面ごとの WAV を作り、長さを demo/audio/durations.json に書く。
 *   node demo/scripts/synth-voicevox.ts [--host http://localhost:50021] [--name 四国めたん] [--style ノーマル] [--speaker 2]
 *                                       [--speed 1.0] [--scene 4] [--no-pad] [--list]
 * エンジンが無ければ手順を表示して終了する。音声ファイルは git 管理外（demo/audio/）。
 * 作った音声を使うときは、音声ライブラリの規約に従いクレジット（例：VOICEVOX:四国めたん）を表記する（demo/README.md）。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { audioDir, loadNarration, wavDurationSeconds } from "./lib.ts";

type Speaker = { name: string; speaker_uuid: string; styles: { name: string; id: number }[] };

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0) return process.argv[i + 1] ?? fallback;
  return fallback;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const host = (arg("host", "http://localhost:50021") ?? "").replace(/\/$/, "");
const speed = Number(arg("speed", "1.0"));
const only = arg("scene");
/** 音声が targetSeconds に満たないとき、末尾を無音で伸ばす（場面の長さと画面の操作の時刻をそろえる）。--no-pad で外す */
const pad = !flag("no-pad");
const wantName = arg("name", "四国めたん") ?? "四国めたん";
const wantStyle = arg("style", "ノーマル") ?? "ノーマル";

async function getSpeakers(): Promise<Speaker[]> {
  const res = await fetch(`${host}/speakers`);
  if (!res.ok) throw new Error(`/speakers が ${res.status}`);
  return (await res.json()) as Speaker[];
}

function howTo(): never {
  console.error(`VOICEVOX エンジンに接続できません（${host}）。

手順：
  1. https://voicevox.hiroshiba.jp/ から VOICEVOX（エディタ同梱のエンジン）を入れて起動する。
     または Docker：docker run --rm -p 50021:50021 voicevox/voicevox_engine:cpu-latest
  2. もう一度このスクリプトを実行する。
  3. 作った音声を公開する場合は、音声ライブラリの規約に従ってクレジットを表記する（demo/README.md）。
音声が無くてもデモモードは原稿の秒数で進む。`);
  process.exit(2);
}

const narration = loadNarration();
let speakers: Speaker[];
try {
  speakers = await getSpeakers();
} catch {
  howTo();
}

if (flag("list")) {
  for (const s of speakers)
    console.log(`${s.name}：${s.styles.map((st) => `${st.name}=${st.id}`).join(", ")}`);
  process.exit(0);
}

let speakerId = arg("speaker") ? Number(arg("speaker")) : undefined;
let speakerLabel = "";
if (speakerId === undefined) {
  const sp = speakers.find((s) => s.name === wantName);
  const st = sp?.styles.find((x) => x.name === wantStyle) ?? sp?.styles[0];
  if (!sp || !st) {
    console.error(
      `話者 ${wantName}（${wantStyle}）が見つかりません。--list で一覧を確認してください。`,
    );
    process.exit(2);
  }
  speakerId = st.id;
  speakerLabel = `${sp.name}（${st.name}）`;
} else {
  for (const s of speakers)
    for (const st of s.styles) if (st.id === speakerId) speakerLabel = `${s.name}（${st.name}）`;
}
console.log(
  `話者：${speakerLabel || speakerId}　速さ：${speed}　クレジット（原稿）：${narration.credits.voice}`,
);
if (speakerLabel && !narration.credits.voice.includes(speakerLabel.split("（")[0] ?? "")) {
  console.warn(
    "注意：narration.json の credits.voice と話者が違います。公開前にクレジット表記を合わせてください。",
  );
}

/** WAV（PCM）の末尾に無音を足して、長さを seconds にそろえる。長ければそのまま（場面が伸びる） */
function padWav(buf: Buffer, seconds: number): Buffer {
  const have = wavDurationSeconds(buf);
  if (have >= seconds) return buf;
  let pos = 12;
  let byteRate = 0;
  let blockAlign = 0;
  while (pos + 8 <= buf.length) {
    const id = buf.toString("ascii", pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    if (id === "fmt ") {
      byteRate = buf.readUInt32LE(pos + 16);
      blockAlign = buf.readUInt16LE(pos + 20);
    }
    if (id === "data") {
      const extra = Math.ceil((seconds - have) * byteRate);
      const silence = Buffer.alloc(extra - (extra % blockAlign));
      const head = Buffer.from(buf.subarray(0, pos + 8 + size));
      head.writeUInt32LE(size + silence.length, pos + 4);
      head.writeUInt32LE(buf.length + silence.length - 8, 4);
      return Buffer.concat([head, silence, buf.subarray(pos + 8 + size)]);
    }
    pos += 8 + size + (size % 2);
  }
  return buf;
}

mkdirSync(audioDir, { recursive: true });
const durations: Record<string, number> = {};
for (const scene of narration.scenes) {
  if (only && String(scene.n) !== only) continue;
  const q = await fetch(
    `${host}/audio_query?${new URLSearchParams({ text: scene.textJa, speaker: String(speakerId) })}`,
    { method: "POST" },
  );
  if (!q.ok) throw new Error(`audio_query（場面 ${scene.n}）が ${q.status}`);
  const query = (await q.json()) as Record<string, unknown>;
  query.speedScale = speed;
  query.outputSamplingRate = 48000;
  // 読み上げの前の無音（場面 7 の「2 秒の無音のあと」など）は、音声の先頭に入れる
  if (scene.leadSilenceSeconds) query.prePhonemeLength = scene.leadSilenceSeconds;
  const s = await fetch(
    `${host}/synthesis?${new URLSearchParams({ speaker: String(speakerId) })}`,
    {
      method: "POST",
      headers: { "content-type": "application/json", accept: "audio/wav" },
      body: JSON.stringify(query),
    },
  );
  if (!s.ok) throw new Error(`synthesis（場面 ${scene.n}）が ${s.status}`);
  let buf: Buffer = Buffer.from(await s.arrayBuffer());
  if (pad) buf = padWav(buf, scene.targetSeconds);
  const path = join(audioDir, `${scene.n}.wav`);
  writeFileSync(path, buf);
  const sec = wavDurationSeconds(buf);
  durations[String(scene.n)] = Math.round(sec * 100) / 100;
  console.log(
    `場面 ${scene.n} ${scene.titleJa}：${sec.toFixed(1)} 秒（目安 ${scene.targetSeconds} 秒）→ ${path}`,
  );
  if (sec > scene.targetSeconds + 0.05)
    console.warn(
      `  注意：読み上げが目安より ${(sec - scene.targetSeconds).toFixed(1)} 秒長く、場面が伸びます。--speed を上げるか、原稿を詰めてください`,
    );
}
const durPath = join(audioDir, "durations.json");
const merged = { ...(await import("./lib.ts")).loadDurations(), ...durations };
writeFileSync(durPath, `${JSON.stringify(merged, null, 2)}\n`);
console.log(`長さを書きました：${durPath}`);
