/** demo/storyboard.json と demo/narration.json の形（zod で検証してから使う） */
import { z } from "zod";

export const OverlayId = z.enum([
  "none",
  "chat-boss",
  "chat-staff",
  "reading",
  "chat-reply",
  "endcard",
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

export const DemoAction = z.discriminatedUnion("do", [
  z.object({ at: z.number().nonnegative(), do: z.literal("route"), to: z.string() }),
  z.object({ at: z.number().nonnegative(), do: z.literal("overlay"), id: OverlayId }),
  z.object({
    at: z.number().nonnegative(),
    do: z.literal("clock"),
    cmd: z.enum(["play", "pause", "toEnd", "restart", "speed"]),
    speed: z.number().positive().optional(),
  }),
  z.object({ at: z.number().nonnegative(), do: z.literal("measures"), ids: z.array(z.string()) }),
  z.object({ at: z.number().nonnegative(), do: z.literal("answers"), list: z.array(DemoAnswer) }),
  z.object({ at: z.number().nonnegative(), do: z.literal("reset") }),
  z.object({ at: z.number().nonnegative(), do: z.literal("scroll"), to: z.string() }),
]);
export type DemoAction = z.infer<typeof DemoAction>;

export const StoryboardScene = z.object({
  n: z.number().int().positive(),
  id: z.string(),
  route: z.string(),
  overlay: OverlayId,
  actions: z.array(DemoAction).default([]),
});
export const Storyboard = z.object({
  version: z.number(),
  profile: z.string(),
  case: z.string(),
  scenes: z.array(StoryboardScene).min(1),
});
export type StoryboardScene = z.infer<typeof StoryboardScene>;
export type Storyboard = z.infer<typeof Storyboard>;

export const NarrationScene = z.object({
  n: z.number().int().positive(),
  id: z.string(),
  titleJa: z.string(),
  targetSeconds: z.number().positive(),
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
