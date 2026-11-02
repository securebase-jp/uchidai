import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../app.ts";

const json = (path: string, body: unknown) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
// biome-ignore lint/suspicious/noExplicitAny: テストでは応答の形を緩く読む
type Loose = any;
const loose = async (res: Response | Promise<Response>): Promise<Loose> => (await res).json();

let savedKey: string | undefined;
beforeAll(() => {
  // 記録の再生を確かめる（Claude は呼ばない）
  savedKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
});
afterAll(() => {
  if (savedKey !== undefined) process.env.ANTHROPIC_API_KEY = savedKey;
});

async function fixture() {
  const c = await loose(app.request("/api/case/recorded/ipa-case-1"));
  const p = await loose(app.request("/api/examples/demo-seiko"));
  return { theCase: c.case, profile: p.profile };
}

describe("POST /api/attacker/recon（記録の再生）", () => {
  it("キーが無ければ記録を再生し、仕込んだ経路（保守接続 → 中核）が source: ai で返る", async () => {
    const { profile } = await fixture();
    const res = await json("/api/attacker/recon", { profile });
    expect(res.status).toBe(200);
    const body = await loose(res);
    expect(body.recorded).toBe(true);
    expect(body.meta.note).toContain("実際の出力の記録");
    expect(body.log[0]).toContain("実際の出力の記録");
    const planted = body.paths.find(
      (p: { steps: { role: string }[] }) => p.steps[0]?.role === "entry.vendor_remote",
    );
    expect(planted).toBeDefined();
    expect(planted.source).toBe("ai");
    expect(planted.reachedCore).toBe(true);
    expect(planted.steps.map((s: { state: string }) => s.state)).toEqual(["breached", "breached"]);
    expect(body.candidates.length).toBeGreaterThan(0);
    // 行は短く、固有名詞を含まない
    for (const l of body.log) {
      expect(l.length).toBeLessThan(220);
      expect(l).not.toMatch(/Fortinet|CVE-|demo-seiko\.example/);
    }
  });
  it("VPN 装置を更新しても保守接続の経路は開いたまま、保守接続の対策で止まる", async () => {
    const { profile } = await fixture();
    const after = await loose(json("/api/attacker/recon", { profile, measureIds: ["vpn-update"] }));
    const planted = after.paths.find(
      (p: { steps: { role: string }[] }) => p.steps[0]?.role === "entry.vendor_remote",
    );
    expect(planted.reachedCore).toBe(true);
    const fixed = await loose(
      json("/api/attacker/recon", { profile, measureIds: ["vpn-update", "vendor-remote-harden"] }),
    );
    const planted2 = fixed.paths.find(
      (p: { steps: { role: string }[] }) => p.steps[0]?.role === "entry.vendor_remote",
    );
    expect(planted2.reachedCore).toBe(false);
    expect(planted2.steps[0].state).toBe("blocked");
  });
  it("記録の無いカルテは空の結果と理由を返す", async () => {
    const { profile } = await fixture();
    const body = await loose(
      json("/api/attacker/recon", { profile: { ...profile, id: "nobody" } }),
    );
    expect(body.paths).toEqual([]);
    expect(body.meta.unavailable).toBeTruthy();
  });
});

describe("POST /api/attacker/validate", () => {
  it("候補を現在のカルテで検証し直す（つながりの無い経路は破棄）", async () => {
    const { profile } = await fixture();
    const body = await loose(
      json("/api/attacker/validate", {
        profile,
        candidates: [
          {
            titleJa: "保守接続から",
            steps: [
              { role: "entry.vendor_remote", technique: "T1133", reasonJa: "常時接続" },
              { role: "core", technique: "T1486", reasonJa: "直結" },
            ],
          },
          {
            titleJa: "つながらない",
            steps: [
              { role: "pc", technique: "T1566", reasonJa: "x" },
              { role: "core", technique: "T1486", reasonJa: "y" },
            ],
          },
        ],
      }),
    );
    expect(body.paths.length).toBe(1);
    expect(body.discarded.length).toBe(1);
    expect(body.discarded[0].reasons[0]).toContain("つながり");
  });
  it("禁止語を含む候補や長すぎる理由は 400", async () => {
    const { profile } = await fixture();
    const res = await json("/api/attacker/validate", {
      profile,
      candidates: [
        {
          steps: [
            { role: "entry.vendor_remote", technique: "T1133", reasonJa: "あ".repeat(200) },
            { role: "core", technique: "T1486", reasonJa: "y" },
          ],
        },
      ],
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/attacker/compare", () => {
  it("記録済みの事例は再生し、多要素認証は「効かない」に理由つきで入る", async () => {
    const { theCase, profile } = await fixture();
    const ev = await loose(json("/api/evaluate", { case: theCase, profile }));
    const res = await json("/api/attacker/compare", { caseId: "ipa-case-1", verdict: ev.verdict });
    expect(res.status).toBe(200);
    const body = await loose(res);
    expect(body.recorded).toBe(true);
    const c = body.comparison;
    expect(c.counts.total).toBeGreaterThan(5);
    const mfa = c.ineffective.find((m: { mitigation: string }) => m.mitigation === "M1032");
    expect(mfa).toBeDefined();
    expect(mfa.verdictReasonJa).toBeTruthy();
    expect(c.effective.map((m: { mitigation: string }) => m.mitigation)).toContain("M1051");
    expect(c.unmapped.length + c.outside.length).toBeGreaterThan(0);
  });
  it("記録が無くキーも無ければ 503 と日本語の理由", async () => {
    const { theCase, profile } = await fixture();
    const ev = await loose(json("/api/evaluate", { case: theCase, profile }));
    const res = await json("/api/attacker/compare", { case: theCase, verdict: ev.verdict });
    expect(res.status).toBe(503);
    expect((await loose(res)).error).toContain("ANTHROPIC_API_KEY");
  });
});
