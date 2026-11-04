/**
 * 絵コンテと原稿を読み、場面ごとに「操作・原稿・長さ」を一つにまとめる。
 * 長さの優先順位：音声ファイルの長さ（durations.json か、読み込んだ音声の長さ）→ 原稿の targetSeconds
 */
import endcardFactsJson from "../../../../../demo/endcard-facts.json";
import narrationJson from "../../../../../demo/narration.json";
import storyboardJson from "../../../../../demo/storyboard.json";
import {
  EndcardFacts,
  Narration,
  type NarrationScene,
  Storyboard,
  type StoryboardScene,
} from "./schema.ts";

export const storyboard: Storyboard = Storyboard.parse(storyboardJson);
export const narration: Narration = Narration.parse(narrationJson);
export const endcardFacts: EndcardFacts = EndcardFacts.parse(endcardFactsJson);

export type DemoScene = {
  n: number;
  index: number;
  board: StoryboardScene;
  script: NarrationScene;
  /** 音声ファイルがあれば URL */
  audioUrl?: string;
  /** 音声の長さ（秒）。無ければ原稿の目安 */
  seconds: number;
  fromAudio: boolean;
};

export function buildScenes(available: Record<string, number | true>): DemoScene[] {
  return storyboard.scenes.map((board, index) => {
    const script = narration.scenes.find((s) => s.n === board.n);
    if (!script) throw new Error(`原稿に場面 ${board.n} がありません（demo/narration.json）`);
    const a = available[String(board.n)];
    const scene: DemoScene = {
      n: board.n,
      index,
      board,
      script,
      seconds: typeof a === "number" ? a : script.targetSeconds,
      fromAudio: typeof a === "number",
    };
    if (a !== undefined) scene.audioUrl = `/api/demo/audio/${board.n}`;
    return scene;
  });
}

/** 字幕：場面の中で、文字数に比例して cue を並べる */
export function cueAt(scene: DemoScene, elapsed: number): string {
  const cues = scene.script.subtitleJa;
  const total = cues.reduce((n, c) => n + c.length, 0) || 1;
  let acc = 0;
  for (const c of cues) {
    acc += c.length;
    if (elapsed < (scene.seconds * acc) / total) return c;
  }
  return cues[cues.length - 1] ?? "";
}
