/** demo/storyboard.json と demo/narration.json の形（zod で検証してから使う） */
import { z } from "zod";

/** 画面の全面に重ねる演出。差し込み口（slot:*）は他セッションの部品がつながる */
export const OverlayId = z.enum([
  "none",
  "chat-boss",
  "chat-staff",
  "chat-reply",
  "declaration",
  "reading",
  "build",
  "conclusion",
  "endcard-roles",
  "endcard-trace",
  "endcard-close",
  "slot:recon",
  "slot:attacker",
  "slot:request",
  "slot:comparison",
]);
export type OverlayId = z.infer<typeof OverlayId>;

export const DemoAnswer = z.object({
  assetId: z.string(),
  mitigation: z.string().regex(/^(M\d{4}|UD-\d{2})$/),
  status: z.enum(["present", "absent", "unknown"]),
  evidence: z.enum(["external", "vendor", "registered", "none"]),
  answeredBy: z.string(),
  noteJa: z.string().optional(),
});
export type DemoAnswer = z.infer<typeof DemoAnswer>;

const At = z.number().nonnegative();

export const DemoAction = z.discriminatedUnion("do", [
  z.object({ at: At, do: z.literal("route"), to: z.string() }),
  z.object({ at: At, do: z.literal("overlay"), id: OverlayId }),
  z.object({
    at: At,
    do: z.literal("clock"),
    cmd: z.enum(["play", "pause", "toEnd", "restart", "speed"]),
    speed: z.number().positive().optional(),
  }),
  z.object({ at: At, do: z.literal("measures"), ids: z.array(z.string()) }),
  z.object({ at: At, do: z.literal("answers"), list: z.array(DemoAnswer) }),
  z.object({ at: At, do: z.literal("reset") }),
  z.object({
    at: At,
    do: z.literal("scroll"),
    to: z.string(),
    /** 要素をどこに寄せるか（既定は center） */
    block: z.enum(["start", "center"]).optional(),
  }),
  /** 画面の部品を実際に押す（押した場所に輪を出す）。nth は同じセレクタの何番目か（0 始まり）、text はその文字を含む要素に絞る */
  z.object({
    at: At,
    do: z.literal("click"),
    target: z.string(),
    nth: z.number().int().nonnegative().optional(),
    text: z.string().optional(),
  }),
  /** 入力欄に値を入れる（押された画面の部品の onChange が動く） */
  z.object({
    at: At,
    do: z.literal("fill"),
    target: z.string(),
    value: z.string(),
    nth: z.number().int().nonnegative().optional(),
  }),
]);
export type DemoAction = z.infer<typeof DemoAction>;

/** 3 枚の壁：専門知識／相談相手と予算／時間。場面 2 で立ち、場面 3・8・9 で順に崩れる */
export const WallId = z.enum(["expert", "advisor", "time"]);
export type WallId = z.infer<typeof WallId>;

const Span = { from: At, to: At };
/** storyboard.json の options で入切する層（既定は出さない） */
export const LayerFlag = z.enum(["policeStat"]);
export type LayerFlag = z.infer<typeof LayerFlag>;

/**
 * 時刻つきの演出の層。場面の経過秒数だけで決まる（一時停止すると止まり、場面を飛ばしても同じ絵になる）。
 * 画面の操作（actions）と違い、状態を持たない見た目だけのもの
 */
export const Layer = z.discriminatedUnion("kind", [
  /** 暗転（黒で覆う）。opacity < 1 で「沈む」 */
  z.object({
    kind: z.literal("dim"),
    ...Span,
    opacity: z.number().min(0).max(1).default(1),
    fadeIn: z.number().nonnegative().default(0.5),
    fadeOut: z.number().nonnegative().default(0.5),
    when: LayerFlag.optional(),
  }),
  /** 字だけの層：帯（細い帯）、宣言、注記 */
  z.object({
    kind: z.literal("text"),
    ...Span,
    text: z.string(),
    pos: z
      .enum(["band", "center", "bottom", "top-left", "top-right", "bottom-left", "bottom-right"])
      .default("center"),
    size: z.enum(["xl", "lg", "md", "sm"]).default("md"),
    serif: z.boolean().default(false),
    fade: z.number().nonnegative().default(0.4),
    when: LayerFlag.optional(),
  }),
  /** 札：「架空の会社」「実際の記録」 */
  z.object({
    kind: z.literal("badge"),
    ...Span,
    text: z.string(),
    pos: z.enum(["top-left", "top-right", "bottom-left", "bottom-right"]).default("top-right"),
    tone: z.enum(["fiction", "record"]).default("fiction"),
    when: LayerFlag.optional(),
  }),
  /** 壁。big は画面の中央に大きく（場面 2）、strip は下に小さな帯（場面 3・8・9） */
  z.object({
    kind: z.literal("walls"),
    ...Span,
    size: z.enum(["big", "strip"]).default("strip"),
    /** この時刻から立つ（rise）。standing は最初から立っている */
    standing: z.array(WallId).default([]),
    rise: z.array(z.object({ wall: WallId, at: At })).default([]),
    /** すでに崩れている壁と、この時刻に崩れる壁 */
    fallen: z.array(WallId).default([]),
    crumble: z.array(z.object({ wall: WallId, at: At })).default([]),
    when: LayerFlag.optional(),
  }),
  /** 図への寄り：担当者画面の構成図を、ノードに寄せる（拡大してそのノードを中央に） */
  z.object({
    kind: z.literal("zoom"),
    ...Span,
    target: z.string(),
    scale: z.number().min(1).max(4).default(1.8),
    when: LayerFlag.optional(),
  }),
]);
export type Layer = z.infer<typeof Layer>;
export type LayerInput = z.input<typeof Layer>;

export const StoryboardScene = z.object({
  n: z.number().int().positive(),
  id: z.string(),
  route: z.string(),
  overlay: OverlayId,
  actions: z.array(DemoAction).default([]),
  layers: z.array(Layer).default([]),
});
export const Storyboard = z.object({
  version: z.number(),
  profile: z.string(),
  case: z.string(),
  /** 出すか決めていない演出の入切（URL の &police=1 / 0 でも上書きできる） */
  options: z.object({ policeStat: z.boolean().default(false) }).default({ policeStat: false }),
  scenes: z.array(StoryboardScene).min(1),
});
export type StoryboardScene = z.infer<typeof StoryboardScene>;
export type Storyboard = z.infer<typeof Storyboard>;

export const NarrationScene = z.object({
  n: z.number().int().positive(),
  id: z.string(),
  titleJa: z.string(),
  targetSeconds: z.number().positive(),
  /** 読み上げの前に置く無音（秒）。音声の先頭に入れる */
  leadSilenceSeconds: z.number().nonnegative().optional(),
  textJa: z.string(),
  subtitleJa: z.array(z.string()).min(1),
  onScreen: z.string().optional(),
});
export const Narration = z.object({
  version: z.number(),
  totalTargetSeconds: z.number().positive(),
  credits: z.object({
    voice: z.string(),
    voiceNoteJa: z.string().optional(),
    fonts: z.string(),
    attack: z.string().optional(),
    github: z.string(),
  }),
  scenes: z.array(NarrationScene).min(1),
});
export type NarrationScene = z.infer<typeof NarrationScene>;
export type Narration = z.infer<typeof Narration>;

/** demo/endcard-facts.json：エンドカード後半に出す開発の跡の数字 */
export const EndcardFacts = z.object({
  verifyBeforeRecording: z.boolean(),
  measuredAt: z.string(),
  sessions: z.object({
    total: z.number().int().positive(),
    approx: z.boolean(),
    areasJa: z.array(z.string()).min(1),
  }),
  roles: z.array(z.object({ model: z.string(), roleJa: z.string() })).min(1),
  scoring: z.object({
    records: z.number().int().positive(),
    cases: z.number().int().positive(),
    series: z
      .array(
        z.object({
          labelJa: z.string(),
          withKnowledge: z.number(),
          withoutKnowledge: z.number().optional(),
        }),
      )
      .min(2),
  }),
  audits: z.object({
    sessions: z.number().int().positive(),
    found: z.number().int().positive(),
    approx: z.boolean(),
    examplesJa: z.array(z.string()),
  }),
  commits: z.number().int().positive(),
});
export type EndcardFacts = z.infer<typeof EndcardFacts>;
