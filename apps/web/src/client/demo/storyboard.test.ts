/**
 * demo/storyboard.json と demo/narration.json の整合：
 * 場面の対応、操作の時刻が場面の長さを超えない、参照する要素のセレクタが画面にある、
 * answers の資産と緩和策がデモ用カルテにある、measures の ID が knowledge にある
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { CompanyProfile, loadKnowledge, repoRoot } from "@uchidai/engine";
import { describe, expect, it } from "vitest";
import { buildScenes, cueAt, narration, storyboard } from "./data.ts";

function sourcesUnder(dir: string): string {
  let out = "";
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out += sourcesUnder(p);
    else if (/\.(tsx|css)$/.test(f)) out += readFileSync(p, "utf8");
  }
  return out;
}
const clientSource = sourcesUnder(join(repoRoot, "apps", "web", "src", "client"));
const profile = CompanyProfile.parse(
  JSON.parse(readFileSync(join(repoRoot, "examples", `${storyboard.profile}.json`), "utf8")),
);
const knowledge = loadKnowledge();

describe("絵コンテと原稿の整合", () => {
  it("場面の番号が一致し、順に並び、原稿の合計秒数が totalTargetSeconds", () => {
    const a = storyboard.scenes.map((s) => s.n);
    const b = narration.scenes.map((s) => s.n);
    expect(a).toEqual(b);
    expect(a).toEqual(a.map((_, i) => i + 1));
    expect(storyboard.scenes.map((s) => s.id)).toEqual(narration.scenes.map((s) => s.id));
    const total = narration.scenes.reduce((n, s) => n + s.targetSeconds, 0);
    expect(total).toBe(narration.totalTargetSeconds);
    expect(total).toBeLessThanOrEqual(180);
  });
  it("操作の時刻は場面の長さを超えず、時刻順に並ぶ", () => {
    for (const s of storyboard.scenes) {
      const script = narration.scenes.find((x) => x.n === s.n);
      expect(script).toBeDefined();
      let prev = -1;
      for (const a of s.actions) {
        expect(a.at, `場面 ${s.n} の操作 ${a.do}`).toBeLessThanOrEqual(script?.targetSeconds ?? 0);
        expect(a.at, `場面 ${s.n} の操作は時刻順`).toBeGreaterThanOrEqual(prev);
        prev = a.at;
      }
    }
  });
  it("route はこの画面のハッシュで、デモ用カルテと事例を指す", () => {
    for (const s of storyboard.scenes) {
      const h = s.route.replace(/^#\/?/, "").split("?")[0] ?? "";
      expect(["", "questions", "staff", "exec", "onepager"], `場面 ${s.n} の route`).toContain(h);
    }
    expect(storyboard.profile).toBe(profile.id);
    expect(profile.fictional).toBe(true);
    expect(storyboard.case).toMatch(/^ipa-case-\d$/);
  });
  it("scroll のセレクタは画面の部品に実在するクラス", () => {
    for (const s of storyboard.scenes)
      for (const a of s.actions) {
        if (a.do !== "scroll" || a.to === "top") continue;
        for (const cls of a.to.split(".").filter(Boolean))
          expect(
            new RegExp(`\\b${cls}\\b`).test(clientSource),
            `場面 ${s.n} のセレクタ ${a.to}`,
          ).toBe(true);
      }
  });
  it("answers の資産と緩和策はデモ用カルテにあり、measures の ID は knowledge にある", () => {
    const measureIds = new Set(knowledge.measures.map((m) => m.id));
    for (const s of storyboard.scenes)
      for (const a of s.actions) {
        if (a.do === "answers")
          for (const x of a.list) {
            const asset = profile.assets.find((y) => y.id === x.assetId);
            expect(asset, `場面 ${s.n} の資産 ${x.assetId}`).toBeDefined();
            expect(
              asset?.controls.some((c) => c.mitigation === x.mitigation),
              `場面 ${s.n}：${x.assetId} に ${x.mitigation} の項目`,
            ).toBe(true);
          }
        if (a.do === "measures")
          for (const id of a.ids) expect(measureIds.has(id), `場面 ${s.n} の対策 ${id}`).toBe(true);
      }
  });
  it("buildScenes は音声の長さを優先し、無ければ原稿の秒数。字幕は場面の中で切り替わる", () => {
    const scenes = buildScenes({ "1": 12.5, "2": true });
    expect(scenes[0]?.seconds).toBe(12.5);
    expect(scenes[0]?.fromAudio).toBe(true);
    expect(scenes[0]?.audioUrl).toBe("/api/demo/audio/1");
    expect(scenes[1]?.seconds).toBe(narration.scenes[1]?.targetSeconds);
    expect(scenes[1]?.fromAudio).toBe(false);
    expect(scenes[1]?.audioUrl).toBe("/api/demo/audio/2");
    expect(scenes[2]?.audioUrl).toBeUndefined();
    const s4 = scenes[3];
    if (!s4) throw new Error("場面 4 がありません");
    expect(cueAt(s4, 0)).toBe(s4.script.subtitleJa[0]);
    expect(cueAt(s4, s4.seconds + 1)).toBe(s4.script.subtitleJa[s4.script.subtitleJa.length - 1]);
  });
});
