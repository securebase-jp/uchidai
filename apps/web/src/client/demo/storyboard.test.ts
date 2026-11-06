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
import { matchesOnePagerRecording, OnePagerRecording } from "../../shared/onepagerRecording.ts";
import { findSecretLike } from "../../shared/vendorRequestRecording.ts";
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
  it("demo/endcard-facts.json は直前の数え直しを促す印があり、計画担当のモデル名は出さない", () => {
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
  it("字幕の開始時刻（cueStarts）は、字幕の行数と同じ数で、昇順で、場面の長さに収まる", () => {
    for (const s of narration.scenes) {
      if (!s.cueStarts) continue;
      expect(s.cueStarts, `場面 ${s.n}`).toHaveLength(s.subtitleJa.length);
      for (let i = 1; i < s.cueStarts.length; i++)
        expect(s.cueStarts[i] ?? 0, `場面 ${s.n}`).toBeGreaterThan(s.cueStarts[i - 1] ?? 0);
      expect(s.cueStarts[s.cueStarts.length - 1] ?? 0, `場面 ${s.n}`).toBeLessThan(s.targetSeconds);
    }
  });
  it("11 場面で、読み上げは 890 字以内に収まり（実際の音声は各場面の長さに収まることを確かめてある）、先頭の無音は場面の長さより短い", () => {
    expect(narration.scenes).toHaveLength(11);
    const chars = narration.scenes.reduce(
      (n, s) => n + s.textJa.replace(/[\s「」『』、。・！？!?（）()：:…—]/g, "").length,
      0,
    );
    expect(chars).toBeLessThanOrEqual(890);
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
  it("click / fill / tap のセレクタは画面の部品に実在するクラス（場面 3・5・9）", () => {
    const ops = storyboard.scenes.flatMap((s) =>
      s.actions.flatMap((a) =>
        a.do === "click" || a.do === "fill" || a.do === "tap" ? [{ n: s.n, a }] : [],
      ),
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

describe("動画の磨き込み（0〜4・6）", () => {
  const scene = (n: number) => {
    const s = storyboard.scenes.find((x) => x.n === n);
    if (!s) throw new Error(`場面 ${n} がありません`);
    return s;
  };
  it("冒頭の 4 秒：場面 1 はコールドオープンで始まり、4 秒でチャットへ。読み上げはチャットが出て 1 秒後（5 秒）から", () => {
    const s1 = scene(1);
    expect(s1.overlay).toBe("cold-open");
    expect(s1.actions.find((a) => a.do === "overlay")).toMatchObject({ at: 4, id: "chat-boss" });
    const n1 = narration.scenes.find((x) => x.n === 1);
    // チャットの画面が出てから話し始める（開発者の指摘、11/5）
    expect(n1?.leadSilenceSeconds).toBe(5);
    expect(n1?.cueStarts?.[0]).toBeGreaterThanOrEqual(5);
    // 帯もチャットが出てから
    for (const l of s1.layers) expect(l.from).toBeGreaterThanOrEqual(4);
    expect(narration.totalTargetSeconds).toBe(180);
  });
  it("下の段：帯・下の注記・壁の帯は、同じ場面の中で時間が重ならない（字幕はその下の段だけ）", () => {
    for (const s of storyboard.scenes) {
      const rows = s.layers.filter(
        (l) =>
          (l.kind === "text" &&
            ["band", "bottom", "bottom-left", "bottom-right"].includes(l.pos)) ||
          (l.kind === "walls" && l.size === "strip") ||
          (l.kind === "badge" && l.pos.startsWith("bottom")),
      );
      for (let i = 0; i < rows.length; i++)
        for (let j = i + 1; j < rows.length; j++) {
          const a = rows[i];
          const b = rows[j];
          if (!a || !b || a.when || b.when) continue;
          expect(
            a.to <= b.from || b.to <= a.from,
            `場面 ${s.n} の下の段 ${a.kind} と ${b.kind}`,
          ).toBe(true);
        }
    }
  });
  it("壁の帯は、崩れたあと場面の終わりまで残さない（次の場面に前の札を持ち越さない）", () => {
    for (const s of storyboard.scenes)
      for (const l of s.layers)
        if (l.kind === "walls" && l.size === "strip") {
          const last = Math.max(...l.crumble.map((c) => c.at));
          const len = narration.scenes.find((x) => x.n === s.n)?.targetSeconds ?? 0;
          expect(l.to, `場面 ${s.n} の壁の帯`).toBeLessThanOrEqual(last + 1.4);
          expect(l.to, `場面 ${s.n} の壁の帯`).toBeLessThan(len);
        }
  });
  it("カーソルは場面 3（URL を貼る）・5（返事の番号を入れる）・9（一枚を開く）だけで、どれも押す操作がある", () => {
    const withCursor = storyboard.scenes.filter((s) => s.cursor).map((s) => s.n);
    expect(withCursor).toEqual([3, 5, 9]);
    for (const n of withCursor)
      expect(
        scene(n).actions.some((a) => a.do === "click" || a.do === "fill" || a.do === "tap"),
        `場面 ${n}`,
      ).toBe(true);
    const s3 = scene(3).actions.filter((a) => a.do === "tap");
    expect(s3.map((a) => (a.do === "tap" ? a.target : ""))).toEqual([
      ".reading-input",
      ".reading-row .btn",
    ]);
  });
  it("寄り（spot）は 5 か所：場面 3 の読解の表、8 の「効かない」の行、9 の一枚の結論・止まる業務・対策。どれもクラスが画面にある", () => {
    const spots = storyboard.scenes.flatMap((s) =>
      s.layers.flatMap((l) => (l.kind === "spot" ? [{ n: s.n, l }] : [])),
    );
    expect(spots.map((x) => x.n)).toEqual([3, 8, 9, 9, 9]);
    for (const { n, l } of spots)
      for (const cls of `${l.container} ${l.target}`.match(/\.[A-Za-z][\w-]*/g) ?? [])
        expect(new RegExp(`\\b${cls.slice(1)}\\b`).test(clientSource), `場面 ${n} の ${cls}`).toBe(
          true,
        );
    const s9 = spots.filter((x) => x.n === 9).map((x) => x.l);
    expect(s9.map((l) => (l.kind === "spot" ? l.target : ""))).toEqual([
      ".op-verdict",
      ".op-stopped",
      ".op-measures",
    ]);
    // 結論（上）を 1.5 秒見せてから、止まる業務 → 対策
    const first = s9[0];
    expect(first ? first.to - first.from : 0).toBeCloseTo(1.5, 5);
  });
  it("場面 9：一枚はカーソルで「AI で一枚を作る」を押してから出し、記録の札を出す", () => {
    const s9 = scene(9);
    const click = s9.actions.find((a) => a.do === "click");
    expect(click).toMatchObject({ target: ".op-generate .btn.primary" });
    const firstSpot = s9.layers.find((l) => l.kind === "spot");
    expect(firstSpot?.from ?? 0).toBeGreaterThan(click?.at ?? 99);
    expect(
      s9.layers.some(
        (l) => l.kind === "badge" && l.tone === "record" && l.text === "Claude の言い換え（記録）",
      ),
    ).toBe(true);
  });
});

describe("場面 9 の一枚の記録（demo/recordings/onepager.demo-seiko.ipa-case-1.json）", () => {
  const raw = readFileSync(
    join(repoRoot, "demo", "recordings", "onepager.demo-seiko.ipa-case-1.json"),
    "utf8",
  );
  const rec = OnePagerRecording.parse(JSON.parse(raw));
  it("Claude の言い換えの実際の出力で、キーやヘッダを含まない", () => {
    expect(rec.response.text.source).toBe("claude");
    expect(rec.model).toMatch(/^claude-/);
    expect(findSecretLike(raw)).toEqual([]);
    for (const line of rec.response.onePager.whatHappensJa)
      expect(line, "手法・緩和策の ID は出さない").not.toMatch(/\b(T\d{4}|M\d{4})/);
  });
  it("場面 9 の画面（会社・事例・対策）と、場面 5 のベンダー回答（番号 1）の状態に合う", () => {
    const route = scene9Route();
    const p = new URLSearchParams(route.split("?")[1] ?? "");
    expect(
      matchesOnePagerRecording(rec, {
        profileId: p.get("profile") ?? undefined,
        caseId: p.get("case") ?? undefined,
        measureIds: (p.get("measures") ?? "").split(",").filter(Boolean),
        answers: rec.answers.map((a) => ({
          ...a,
          answeredAt: "2026-11-07T00:00:00.000Z",
          noteJa: "別の時刻",
        })),
      }),
    ).toBe(true);
    expect(rec.answers).toHaveLength(1);
    expect(rec.answers[0]).toMatchObject({
      assetId: "admin",
      mitigation: "M1026",
      status: "absent",
    });
    expect(questionFor("M1026", "admin")?.choices[0]?.status).toBe("absent");
  });
  it("条件が違えば記録を使わない（回答なし・対策あり・別の会社）", () => {
    const base = {
      profileId: rec.profileId,
      caseId: rec.caseId,
      measureIds: [],
      answers: rec.answers,
    };
    expect(matchesOnePagerRecording(rec, base)).toBe(true);
    expect(matchesOnePagerRecording(rec, { ...base, answers: [] })).toBe(false);
    expect(matchesOnePagerRecording(rec, { ...base, measureIds: ["vpn-update"] })).toBe(false);
    expect(matchesOnePagerRecording(rec, { ...base, profileId: "demo-other" })).toBe(false);
  });
});

function scene9Route(): string {
  return storyboard.scenes.find((s) => s.n === 9)?.route ?? "";
}
