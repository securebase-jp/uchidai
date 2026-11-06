import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { wavDurationSeconds } from "./lib.ts";
import {
  buildMixArgs,
  buildSfxTrackArgs,
  DEFAULT_SFX_GAIN_DB,
  loadSfx,
  muteFilter,
  parseSfx,
  type ResolvedCue,
  resolveCues,
  resolveMutes,
  type SfxCue,
  STRONG_EXTRA_DB,
} from "./sfx-lib.ts";
import {
  buildFilterComplex,
  buildSynthArgs,
  PEAK_LIMIT,
  RECIPES,
  SAMPLE_RATE,
  SOUND_NAMES,
} from "./sfx-sounds.ts";

// ffmpeg を何度も起動する試験は、遅い環境で vitest の既定の 5 秒を超える（#10）。このファイルは 60 秒まで待つ
vi.setConfig({ testTimeout: 60_000 });

const hasFfmpeg =
  spawnSync("ffmpeg", ["-version"]).status === 0 && spawnSync("ffprobe", ["-version"]).status === 0;
const scripts = import.meta.dirname;
const node = process.execPath;

const cue = (o: Partial<SfxCue> & Pick<SfxCue, "scene" | "at" | "sound">): SfxCue => ({
  gain: 1,
  ...o,
});

describe("sfx.json のスキーマ", () => {
  it("リポジトリの sfx.json が検証を通り、脚本の表にある場面と音をすべて含む", () => {
    const sfx = loadSfx();
    const scenes = new Set(sfx.cues.map((c) => c.scene));
    for (const n of [1, 2, 4, 5, 6, 7, 8, 9]) expect(scenes.has(n)).toBe(true);
    const bySound = (s: string) => sfx.cues.filter((c) => c.sound === s).map((c) => c.scene);
    expect(bySound("message")).toEqual([1, 9]);
    expect(bySound("wall-up")).toEqual([2, 2, 2]);
    expect(new Set(bySound("tick"))).toEqual(new Set([4]));
    expect(new Set(bySound("scan"))).toEqual(new Set([1, 5])); // 1 は冒頭の 4 秒の赤い線
    expect(bySound("flip")).toEqual([5]);
    expect(new Set(bySound("verify"))).toEqual(new Set([6]));
    expect(bySound("count")).toEqual([7]);
    expect(bySound("impact")).toEqual([7]);
    expect(bySound("shield-bounce")).toEqual([8]);
    expect(bySound("green-spread")).toEqual([8]);
    expect(bySound("wall-down")).toContain(9);
    // 山場の強い一打：冒頭の数字と「効かない」は stamp、「赤に変わる」は red-hit。結論の直前は riser を切る
    expect(bySound("stamp")).toEqual([1, 8]);
    expect(bySound("red-hit")).toEqual([5]);
    expect(bySound("riser")).toEqual([7]);
    for (const c of sfx.cues.filter(
      (x) => x.sound === "red-hit" || (x.sound === "stamp" && x.scene === 8),
    ))
      expect(c.strong, `${c.sound}（場面 ${c.scene}）`).toBe(true);
    // 使っていない音が無い（作るだけで鳴らさない音を残さない）
    for (const name of SOUND_NAMES) expect(bySound(name).length).toBeGreaterThan(0);
  });

  it("音を切る区間：冒頭の 4 秒の最後の 0.5 秒と、結論の直前の 0.8 秒（結論の一打の時刻で終わる）", () => {
    const sfx = loadSfx();
    expect(sfx.mutes).toEqual([
      expect.objectContaining({ scene: 1, at: 3.5, seconds: 0.5 }),
      expect.objectContaining({ scene: 7, at: 1.2, seconds: 0.8 }),
    ]);
    const impact = sfx.cues.find((c) => c.sound === "impact");
    const m7 = sfx.mutes.find((m) => m.scene === 7);
    expect((m7?.at ?? 0) + (m7?.seconds ?? 0)).toBeCloseTo(impact?.at ?? -1, 5);
    const riser = sfx.cues.find((c) => c.sound === "riser");
    expect(riser?.at ?? 99).toBeLessThan(m7?.at ?? 0); // 高まってから切る
  });

  it("同じ場面の cue の at が負でなく、gain が 0〜1", () => {
    for (const c of loadSfx().cues) {
      expect(c.at).toBeGreaterThanOrEqual(0);
      expect(c.gain).toBeGreaterThanOrEqual(0);
      expect(c.gain).toBeLessThanOrEqual(1);
    }
  });

  it("不正な cue を弾く", () => {
    const ok = { scene: 1, at: 0, sound: "tick", gain: 0.5 };
    expect(() => parseSfx({ version: 1, cues: [ok] })).not.toThrow();
    expect(() => parseSfx({ version: 1, cues: [] })).toThrow();
    expect(() => parseSfx({ version: 2, cues: [ok] })).toThrow();
    expect(() => parseSfx({ version: 1, cues: [{ ...ok, sound: "boom" }] })).toThrow();
    expect(() => parseSfx({ version: 1, cues: [{ ...ok, gain: 1.5 }] })).toThrow();
    expect(() => parseSfx({ version: 1, cues: [{ ...ok, scene: 0 }] })).toThrow();
    expect(() => parseSfx({ version: 1, cues: [{ ...ok, at: -1 }] })).toThrow();
    expect(() => parseSfx({ version: 1, cues: [{ ...ok, anchor: "middle" }] })).toThrow();
  });
});

describe("cue の絶対時刻", () => {
  const scenes = [
    { n: 1, start: 0, end: 15 },
    { n: 2, start: 15, end: 30.5 },
    { n: 4, start: 48, end: 62 },
  ];

  it("場面の開始 + at、anchor が end なら場面の終わり - at", () => {
    const r = resolveCues(
      [
        cue({ scene: 2, at: 2, anchor: "end", sound: "wall-up" }),
        cue({ scene: 1, at: 0.4, sound: "message" }),
        cue({ scene: 4, at: 3, sound: "tick" }),
      ],
      scenes,
    );
    expect(r.skipped).toEqual([]);
    expect(r.warnings).toEqual([]);
    // 絶対時刻の昇順
    expect(r.resolved.map((x) => [x.cue.sound, x.abs])).toEqual([
      ["message", 0.4],
      ["wall-up", 28.5],
      ["tick", 51],
    ]);
  });

  it("タイムラインに無い場面は飛ばし、場面の長さを超える cue は警告する", () => {
    const r = resolveCues(
      [
        cue({ scene: 10, at: 1, sound: "tick" }),
        cue({ scene: 1, at: 20, sound: "tick" }),
        cue({ scene: 1, at: 99, anchor: "end", sound: "tick" }),
      ],
      scenes,
    );
    expect(r.skipped.map((s) => s.cue.scene).sort()).toEqual([1, 10]);
    expect(r.resolved).toHaveLength(1);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain("場面 1");
  });

  it("場面の n で照合する（id は使わない）", () => {
    const r = resolveCues(
      [cue({ scene: 4, at: 0, sound: "tick", label: "古い id と違う名前" })],
      scenes,
    );
    expect(r.resolved[0]?.abs).toBe(48);
  });
});

describe("ミックスの ffmpeg 引数", () => {
  const resolved: ResolvedCue[] = [
    { cue: cue({ scene: 1, at: 0.4, sound: "message", gain: 0.8 }), scene: 1, abs: 0.4 },
    { cue: cue({ scene: 4, at: 3, sound: "tick", gain: 0.7 }), scene: 4, abs: 51 },
    { cue: cue({ scene: 4, at: 4.5, sound: "tick", gain: 0.7 }), scene: 4, abs: 52.5 },
  ];

  it("効果音トラック：音ごとに 1 入力、cue ごとにサンプル単位の遅延と gain", () => {
    const a = buildSfxTrackArgs({ cues: resolved, sfxDir: "/s", totalSeconds: 180, out: "/o.wav" });
    expect(a.filter((x) => x === "-i")).toHaveLength(2); // message と tick
    expect(a).toContain("/s/message.wav");
    expect(a).toContain("/s/tick.wav");
    const g = a[a.indexOf("-filter_complex") + 1] ?? "";
    expect(g).toContain("asplit=2"); // tick は 2 回鳴る
    expect(g).toContain(`adelay=${Math.round(0.4 * SAMPLE_RATE)}S:all=1`);
    expect(g).toContain(`adelay=${51 * SAMPLE_RATE}S:all=1`);
    expect(g).toContain(`adelay=${52.5 * SAMPLE_RATE}S:all=1`);
    expect(g).toContain("volume=0.8");
    expect(g).toContain("amix=inputs=3:normalize=0");
    expect(g).toContain("apad=whole_dur=180,atrim=0:180");
    expect(a.at(-1)).toBe("/o.wav");
  });

  it("cue が 1 つでも組み立てられ、0 件ならエラー", () => {
    const one = resolved.slice(0, 1);
    const a = buildSfxTrackArgs({ cues: one, sfxDir: "/s", totalSeconds: 10, out: "/o.wav" });
    expect(a[a.indexOf("-filter_complex") + 1]).toContain("anull");
    expect(() =>
      buildSfxTrackArgs({ cues: [], sfxDir: "/s", totalSeconds: 10, out: "/o" }),
    ).toThrow();
  });

  it("ミックス：効果音を下げ、ナレーションをサイドチェーンにしてダッキングする", () => {
    const a = buildMixArgs({
      narration: "/n.wav",
      sfxTrack: "/t.wav",
      sfxGainDb: -14,
      out: "/m.wav",
    });
    const g = a[a.indexOf("-filter_complex") + 1] ?? "";
    expect(a.slice(0, 4)).toEqual(["-i", "/n.wav", "-i", "/t.wav"]);
    expect(g).toContain("[1:a]volume=-14dB");
    expect(g).toContain("sidechaincompress=");
    expect(g).toMatch(/\[sfxg\]\[key\]sidechaincompress/);
    expect(g).toContain("amix=inputs=2:normalize=0:duration=first");
    expect(DEFAULT_SFX_GAIN_DB).toBe(-14);
  });

  it("強い一打のトラックはダッキングせず大きく混ぜ、音を切る区間は全体にかける", () => {
    const a = buildMixArgs({
      narration: "/n.wav",
      sfxTrack: "/t.wav",
      strongTrack: "/s.wav",
      sfxGainDb: -14,
      mutes: [
        { start: 3.5, end: 4 },
        { start: 101.2, end: 102 },
      ],
      out: "/m.wav",
    });
    expect(a.slice(0, 6)).toEqual(["-i", "/n.wav", "-i", "/t.wav", "-i", "/s.wav"]);
    const g = (a[a.indexOf("-filter_complex") + 1] ?? "").split(";");
    // 先頭の 3 行（ダッキング）は強い一打が無いときと同じ
    expect(g[2]).toMatch(/^\[sfxg\]\[key\]sidechaincompress/);
    expect(g).toContain(`[2:a]volume=${-14 + STRONG_EXTRA_DB}dB[str]`);
    expect(g.join(";")).toContain("[nar][duck][str]amix=inputs=3");
    expect(g.join(";")).not.toMatch(/\[str\]\[key\]|sidechaincompress[^;]*\[str\]/);
    expect(g.at(-1)).toContain("volume=0:enable='between(t,3.5,4)+between(t,101.2,102)'");
    expect(muteFilter([])).toBe("");
  });

  it("音を切る区間を場面の時刻から絶対時刻に直す（場面が無ければ飛ばす）", () => {
    const scenes = [
      { n: 1, start: 0, end: 15 },
      { n: 7, start: 100, end: 115 },
    ];
    expect(
      resolveMutes(
        [
          { scene: 7, at: 1.2, seconds: 0.8 },
          { scene: 1, at: 3.5, seconds: 0.5 },
          { scene: 9, at: 1, seconds: 1 },
        ],
        scenes,
      ),
    ).toEqual([
      { start: 3.5, end: 4 },
      { start: 101.2, end: 102 },
    ]);
  });

  it("ナレーションが無いときは効果音だけを同じ音量で出す", () => {
    const a = buildMixArgs({ sfxTrack: "/t.wav", sfxGainDb: -20, out: "/m.wav" });
    const g = a[a.indexOf("-filter_complex") + 1] ?? "";
    expect(a.filter((x) => x === "-i")).toHaveLength(1);
    expect(g).toContain("volume=-20dB");
    expect(g).not.toContain("sidechaincompress");
  });
});

describe("効果音のレシピ", () => {
  it("全部の音にレシピがあり、長さは 0.05〜2 秒", () => {
    expect(RECIPES.map((r) => r.name).sort()).toEqual([...SOUND_NAMES].sort());
    for (const r of RECIPES) {
      expect(r.dur).toBeGreaterThanOrEqual(0.05);
      expect(r.dur).toBeLessThanOrEqual(2);
    }
  });

  it("ffmpeg の lavfi の合成だけで、ピークを抑え、決定的（seed 固定）で、外部ファイルを読まない", () => {
    for (const r of RECIPES) {
      const g = buildFilterComplex(r);
      expect(g).toContain(`alimiter=limit=${PEAK_LIMIT}`);
      expect(g).toMatch(/\b(sine|aevalsrc|anoisesrc)=/);
      for (const m of g.matchAll(/anoisesrc=[^,]*/g)) expect(m[0]).toContain("seed=");
      const a = buildSynthArgs(r, "/o.wav");
      expect(a).not.toContain("-i"); // 入力ファイルなし（すべてフィルタで生成）
      expect(a).toContain("+bitexact");
    }
    expect(20 * Math.log10(PEAK_LIMIT)).toBeLessThanOrEqual(-6);
  });
});

function volume(file: string, ss?: number, t?: number): { max: number; mean: number } {
  const r = spawnSync(
    "ffmpeg",
    [
      "-hide_banner",
      ...(ss !== undefined ? ["-ss", String(ss)] : []),
      ...(t !== undefined ? ["-t", String(t)] : []),
      "-i",
      file,
      "-af",
      "volumedetect",
      "-f",
      "null",
      "-",
    ],
    { encoding: "utf8" },
  );
  const max = /max_volume: (-?[\d.]+|-inf) dB/.exec(r.stderr)?.[1];
  const mean = /mean_volume: (-?[\d.]+|-inf) dB/.exec(r.stderr)?.[1];
  return { max: Number(max ?? "NaN"), mean: Number(mean ?? "NaN") };
}

describe.skipIf(!hasFfmpeg)("ffmpeg で実際に作る", () => {
  let dir: string;
  let sfxDir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "uchidai-sfx-"));
    sfxDir = join(dir, "sfx");
    execFileSync(node, [join(scripts, "synth-sfx.ts"), "--out-dir", sfxDir], { stdio: "ignore" });
  }, 120_000);
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("synth-sfx.ts が全部の効果音を作る：長さ 0.05〜2 秒、ピーク -6 dBFS 以下、48 kHz モノラル", () => {
    for (const r of RECIPES) {
      const f = join(sfxDir, `${r.name}.wav`);
      expect(existsSync(f), r.name).toBe(true);
      const sec = wavDurationSeconds(readFileSync(f));
      expect(sec).toBeGreaterThanOrEqual(0.05);
      expect(sec).toBeLessThanOrEqual(2);
      expect(Math.abs(sec - r.dur)).toBeLessThan(0.02);
      const v = volume(f);
      expect(v.max, `${r.name} のピーク`).toBeLessThanOrEqual(-6);
      expect(v.max, `${r.name} が無音`).toBeGreaterThan(-20);
      const info = spawnSync(
        "ffprobe",
        ["-v", "error", "-show_entries", "stream=sample_rate,channels", "-of", "csv=p=0", f],
        { encoding: "utf8" },
      ).stdout.trim();
      expect(info).toBe("48000,1");
    }
  });

  it("何度作っても同じ WAV（決定的）", () => {
    const again = join(dir, "again");
    execFileSync(
      node,
      [join(scripts, "synth-sfx.ts"), "--out-dir", again, "--only", "impact,scan"],
      {
        stdio: "ignore",
      },
    );
    for (const n of ["impact", "scan"])
      expect(
        readFileSync(join(again, `${n}.wav`)).equals(readFileSync(join(sfxDir, `${n}.wav`))),
      ).toBe(true);
  });

  it("--list と --dry-run は ffmpeg を呼ばずに表示する", () => {
    const list = spawnSync(node, [join(scripts, "synth-sfx.ts"), "--list"], { encoding: "utf8" });
    for (const n of SOUND_NAMES) expect(list.stdout).toContain(n);
    const dry = spawnSync(
      node,
      [
        join(scripts, "synth-sfx.ts"),
        "--dry-run",
        "--only",
        "tick",
        "--out-dir",
        join(dir, "nope"),
      ],
      { encoding: "utf8" },
    );
    expect(dry.stdout).toContain("$ ffmpeg");
    expect(dry.stdout).toContain("tick.wav");
    expect(existsSync(join(dir, "nope"))).toBe(false);
  });

  it("ナレーションの発話中は効果音が下がる（ダッキング）", () => {
    // 疑似の発話：3〜9 秒に鳴るモジュレーションつきの 220 Hz。効果音は 5 秒（発話中）と 12 秒（発話の外）
    const narration = join(dir, "narration.wav");
    execFileSync(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-filter_complex",
        "aevalsrc=exprs='0.3*sin(2*PI*220*t)*(0.6+0.4*sin(2*PI*4*t))':sample_rate=48000:duration=6,adelay=3000:all=1,apad=whole_dur=16[o]",
        "-map",
        "[o]",
        "-ac",
        "1",
        narration,
      ],
      { stdio: "ignore" },
    );
    const cues: ResolvedCue[] = [
      { cue: cue({ scene: 1, at: 5, sound: "shield-bounce" }), scene: 1, abs: 5 },
      { cue: cue({ scene: 1, at: 12, sound: "shield-bounce" }), scene: 1, abs: 12 },
    ];
    const track = join(dir, "track.wav");
    execFileSync(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        ...buildSfxTrackArgs({ cues, sfxDir, totalSeconds: 16, out: track }),
      ],
      { stdio: "ignore" },
    );
    // 効果音だけ取り出して比べるため、ミックスのグラフから duck の出力を直接取る
    const mix = buildMixArgs({ narration, sfxTrack: track, sfxGainDb: -14, out: "x" });
    const graph = (mix[mix.indexOf("-filter_complex") + 1] ?? "").split(";");
    const duckOnly = join(dir, "duck.wav");
    execFileSync(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        narration,
        "-i",
        track,
        "-filter_complex",
        // ミックスと同じ sidechaincompress の行を使い、使わない出力 [nar] は捨てる
        ["[0:a]asplit=2[nar][key]", graph[1], graph[2], "[nar]anullsink"].join(";"),
        "-map",
        "[duck]",
        duckOnly,
      ],
      { stdio: "ignore" },
    );
    const plain = join(dir, "plain.wav");
    execFileSync(
      "ffmpeg",
      ["-hide_banner", "-loglevel", "error", "-y", "-i", track, "-af", "volume=-14dB", plain],
      { stdio: "ignore" },
    );
    const inSpeechPlain = volume(plain, 5, 0.7).max;
    const inSpeechDucked = volume(duckOnly, 5, 0.7).max;
    const outsidePlain = volume(plain, 12, 0.7).max;
    const outsideDucked = volume(duckOnly, 12, 0.7).max;
    expect(inSpeechPlain - inSpeechDucked).toBeGreaterThan(10); // 発話中は 10 dB 以上下がる
    expect(Math.abs(outsidePlain - outsideDucked)).toBeLessThan(0.5); // 発話の外はそのまま
    expect(outsidePlain).toBeLessThanOrEqual(-6 - 14); // 基準の音より 14 dB 下
  });
});

describe.skipIf(!hasFfmpeg)("assemble.ts（仮の動画と仮の timeline.json）", () => {
  let dir: string;
  let video: string;
  let timeline: string;
  let sfxJson: string;
  let sfxDir: string;
  const run = (extra: string[], work: string) =>
    spawnSync(
      node,
      [
        join(scripts, "assemble.ts"),
        "--video",
        video,
        "--timeline",
        timeline,
        "--sfx",
        sfxJson,
        "--sfx-dir",
        sfxDir,
        "--work-dir",
        join(dir, work),
        "--out",
        join(dir, `${work}.mp4`),
        "--no-subtitles",
        ...extra,
      ],
      { encoding: "utf8" },
    );

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "uchidai-asm-"));
    sfxDir = join(dir, "sfx");
    execFileSync(node, [join(scripts, "synth-sfx.ts"), "--out-dir", sfxDir], { stdio: "ignore" });
    video = join(dir, "video.mp4");
    execFileSync(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "color=c=black:s=320x180:r=30:d=12",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        video,
      ],
      { stdio: "ignore" },
    );
    const sc = (n: number, start: number, end: number) => ({
      n,
      id: `s${n}`,
      titleJa: `場面${n}`,
      start,
      end,
      seconds: end - start,
      fromAudio: false,
      cues: [],
    });
    timeline = join(dir, "timeline.json");
    writeFileSync(timeline, JSON.stringify({ scenes: [sc(1, 0, 4), sc(2, 4, 8), sc(3, 8, 12)] }));
    sfxJson = join(dir, "sfx.json");
    writeFileSync(
      sfxJson,
      JSON.stringify({
        version: 1,
        cues: [
          { scene: 2, at: 1, sound: "impact", gain: 1 }, // 絶対 5 秒
          { scene: 3, at: 1, anchor: "end", sound: "tick", gain: 1 }, // 絶対 11 秒
          { scene: 9, at: 1, sound: "tick", gain: 1 }, // 場面が無い → 飛ばす
        ],
      }),
    );
  }, 120_000);
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("--dry-run：効果音トラックとミックスのコマンドを出し、既存の結合の形（60fps）を保つ", () => {
    const r = run(["--dry-run"], "dry");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(`adelay=${5 * SAMPLE_RATE}S:all=1`);
    expect(r.stdout).toContain(`adelay=${11 * SAMPLE_RATE}S:all=1`);
    expect(r.stdout).toContain("volume=-14dB");
    expect(r.stdout).toContain("sidechaincompress");
    expect(r.stdout).toContain("fps=60");
    expect(r.stdout).toContain("-c:a aac");
    expect(r.stderr).toContain("場面 9"); // 飛ばした cue の理由
  });

  it("--sfx-gain、--no-sfx、--no-audio、--title", () => {
    expect(run(["--dry-run", "--sfx-gain", "-20"], "g").stdout).toContain("volume=-20dB");
    const noSfx = run(["--dry-run", "--no-sfx"], "n").stdout;
    expect(noSfx).not.toContain("sidechaincompress");
    expect(noSfx).toContain("narration.wav");
    const noAudio = run(["--dry-run", "--no-audio"], "a").stdout;
    expect(noAudio).not.toContain("sidechaincompress");
    expect(noAudio).toContain("-an");
    const png = join(dir, "title.png");
    execFileSync(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "color=c=white:s=320x180",
        "-frames:v",
        "1",
        png,
      ],
      { stdio: "ignore" },
    );
    // タイトルカード 3 秒ぶん、効果音を含む音声全体を遅らせる
    expect(run(["--dry-run", "--title", png], "t").stdout).toContain("adelay=3000:all=1");
    expect(run(["--sfx-gain", "abc"], "bad").status).toBe(2);
  });

  it("実際に結合する：1 本の MP4 に音が入り、効果音の区間だけが鳴る", () => {
    const r = run([], "real");
    expect(r.status, r.stderr).toBe(0);
    const out = join(dir, "real.mp4");
    const probe = spawnSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "stream=codec_name,codec_type,width,height",
        "-of",
        "csv=p=0",
        out,
      ],
      { encoding: "utf8" },
    ).stdout;
    expect(probe).toContain("h264,video,1920,1080");
    expect(probe).toContain("aac,audio");
    // 効果音の窓（5〜7 秒：impact）は鳴り、何もない窓（1〜3 秒）は無音に近い
    const hit = volume(out, 5, 2);
    const quiet = volume(out, 1, 2);
    expect(hit.max).toBeGreaterThan(-40);
    expect(hit.max).toBeLessThan(-14); // ナレーションより小さい（ピークでも -14 dBFS より下）
    expect(Number.isFinite(quiet.max) ? quiet.max : -100).toBeLessThan(hit.max - 25);
  }, 120_000);
});
