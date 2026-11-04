/**
 * demo/storyboard.json と demo/narration.json の整合：
 * 場面の対応、操作の時刻が場面の長さを超えない、参照する要素のセレクタが画面にある、
 * answers の資産と緩和策がデモ用カルテにある、measures の ID が knowledge にある
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { CompanyProfile, loadKnowledge, repoRoot } from "@uchidai/engine";
import { describe, expect, it } from "vitest";
import { questionFor } from "../../server/requests/questions.ts";
import { buildScenes, cueAt, endcardFacts, narration, storyboard } from "./data.ts";

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

describe("エンドカードの数字", () => {
  it("demo/endcard-facts.json は直前の数え直しを促す印があり、Mythos の名は出さない", () => {
    expect(endcardFacts.verifyBeforeRecording).toBe(true);
    expect(JSON.stringify(endcardFacts)).not.toMatch(/Mythos/i);
    expect(endcardFacts.roles.map((r) => r.model)).toEqual(["Fable", "Sonnet"]);
    expect(endcardFacts.sessions.total).toBeGreaterThanOrEqual(30);
    const last = endcardFacts.scoring.series.at(-1);
    expect(last?.withKnowledge).toBeLessThanOrEqual(100);
  });
});

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
  it("11 場面で、読み上げは 840 字以内に収まり（実際の音声は各場面の長さに収まることを確かめてある）、先頭の無音は場面の長さより短い", () => {
    expect(narration.scenes).toHaveLength(11);
    const chars = narration.scenes.reduce(
      (n, s) => n + s.textJa.replace(/[\s「」『』、。・！？!?（）()：:…—]/g, "").length,
      0,
    );
    expect(chars).toBeLessThanOrEqual(840);
    for (const s of narration.scenes) {
      expect(s.leadSilenceSeconds ?? 0).toBeLessThan(s.targetSeconds);
      // 読み上げは読みで書く（字幕には正式表記を残す）
      expect(s.textJa, `場面 ${s.n}`).not.toMatch(/Claude|Fable|Sonnet|\bAI\b|VPN/);
      expect(s.textJa, `場面 ${s.n}`).not.toMatch(/Mythos/i);
    }
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
  it("層と overlay の時刻は場面の長さに収まり、overlay の切り替えは時刻順", () => {
    for (const s of storyboard.scenes) {
      const len = narration.scenes.find((x) => x.n === s.n)?.targetSeconds ?? 0;
      for (const l of s.layers) {
        expect(l.from, `場面 ${s.n} の層 ${l.kind}`).toBeLessThan(l.to);
        expect(l.from, `場面 ${s.n} の層 ${l.kind}`).toBeLessThanOrEqual(len);
        if (l.kind === "walls") {
          for (const c of [...l.crumble, ...l.rise]) {
            expect(c.at, `場面 ${s.n} の壁 ${c.wall}`).toBeGreaterThanOrEqual(l.from);
            expect(c.at, `場面 ${s.n} の壁 ${c.wall}`).toBeLessThan(l.to);
          }
        }
      }
    }
  });
  it("壁は場面 2 で立ち、3 → 8 → 9 の順に 1 枚ずつ崩れる", () => {
    const walls = (n: number) =>
      storyboard.scenes
        .find((s) => s.n === n)
        ?.layers.flatMap((l) => (l.kind === "walls" ? [l] : [])) ?? [];
    expect(walls(2)[0]?.rise.map((r) => r.wall)).toEqual(["expert", "advisor", "time"]);
    expect(walls(3)[0]?.crumble.map((c) => c.wall)).toEqual(["expert"]);
    expect(walls(8)[0]?.fallen).toEqual(["expert"]);
    expect(walls(8)[0]?.crumble.map((c) => c.wall)).toEqual(["advisor"]);
    expect(walls(9)[0]?.fallen).toEqual(["expert", "advisor"]);
    expect(walls(9)[0]?.crumble.map((c) => c.wall)).toEqual(["time"]);
  });
  it("警察庁の数字は options で入切する層で、既定は出さない", () => {
    expect(storyboard.options.policeStat).toBe(false);
    const gated = storyboard.scenes.flatMap((s) => s.layers.filter((l) => l.when === "policeStat"));
    expect(gated.length).toBeGreaterThan(0);
  });
  it("zoom の対象は、デモ用カルテの構成グラフにあるノード", () => {
    const ids = new Set(profile.assets.map((a) => a.id));
    for (const s of storyboard.scenes)
      for (const l of s.layers)
        if (l.kind === "zoom")
          expect(ids.has(l.target), `場面 ${s.n} の寄り ${l.target}`).toBe(true);
  });
  it("差し込み口の overlay は slot:recon を含み、場面 4 で使われる", () => {
    const s4 = storyboard.scenes.find((s) => s.n === 4);
    expect(s4?.overlay).toBe("slot:recon");
    // 前半は外部確認の再生、後半は 5 問で図が組み上がる（再生に 9 秒、組み上がりに 5 秒）
    const sw = s4?.actions.find((x) => x.do === "overlay" && x.id === "build");
    expect(sw?.at).toBe(9);
  });
  it("click / fill のセレクタは画面の部品に実在するクラス（場面 5 のベンダー確認）", () => {
    const ops = storyboard.scenes.flatMap((s) =>
      s.actions.flatMap((a) => (a.do === "click" || a.do === "fill" ? [{ n: s.n, a }] : [])),
    );
    expect(ops.length).toBeGreaterThanOrEqual(6);
    for (const { n, a } of ops)
      for (const cls of a.target.match(/\.[A-Za-z][\w-]*/g) ?? [])
        expect(
          new RegExp(`\\b${cls.slice(1)}\\b`).test(clientSource),
          `場面 ${n} のセレクタ ${a.target} の ${cls}`,
        ).toBe(true);
  });
  it("ベンダー確認の返信の番号 1 は、管理者パスワードが共通（status: absent）に当たる", () => {
    const q = questionFor("M1026", "admin");
    expect(q?.choices[0]?.status).toBe("absent");
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
