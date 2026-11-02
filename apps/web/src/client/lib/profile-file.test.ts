import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  EXTERNAL_NOTE_JA,
  exportFileName,
  exportText,
  jsonDepth,
  MAX_DEPTH,
  parseProfileFile,
  pathJa,
} from "./profile-file.ts";
import type { CompanyProfile } from "./types.ts";

const demoPath = join(import.meta.dirname, "../../../../../examples/demo-seiko.json");
const demoText = readFileSync(demoPath, "utf8");

describe("parseProfileFile（カルテ JSON の読み込み）", () => {
  it("架空企業のカルテをそのまま読め、id・fictional・$comment を保つ", () => {
    const r = parseProfileFile(demoText);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.profile.id).toBe("demo-seiko");
    expect(r.profile.fictional).toBe(true);
    expect((r.profile as unknown as { $comment?: string }).$comment).toBeDefined();
    expect(r.profile.assets.length).toBeGreaterThan(5);
  });
  it("書き出したものを読み直すと同じカルテになる", () => {
    const r = parseProfileFile(demoText);
    if (!r.ok) throw new Error(r.reasonJa);
    const again = parseProfileFile(exportText(r.profile));
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.profile).toEqual(r.profile);
  });
  it("壊れた JSON・配列・別の形は日本語の理由つきで失敗する", () => {
    const broken = parseProfileFile("{nope");
    expect(broken.ok).toBe(false);
    if (!broken.ok) expect(broken.reasonJa).toContain("JSON");
    const arr = parseProfileFile("[]");
    expect(arr.ok).toBe(false);
    if (!arr.ok) expect(arr.reasonJa).toContain("カルテの形");
    const other = parseProfileFile(JSON.stringify({ hello: "world" }));
    expect(other.ok).toBe(false);
    if (!other.ok) {
      expect(other.reasonJa).toContain("カルテの形が違います");
      expect(other.reasonJa).toContain("id");
    }
  });
  it("型の違い（status の綴り、負の日数、資産なし）を拒む", () => {
    const base = JSON.parse(demoText) as Record<string, unknown>;
    const assets = base.assets as { controls: { status: string }[] }[];
    const vpn = structuredClone(assets[0]);
    if (!vpn?.controls[0]) throw new Error("fixture");
    vpn.controls[0].status = "yes";
    const bad1 = parseProfileFile(JSON.stringify({ ...base, assets: [vpn, ...assets.slice(1)] }));
    expect(bad1.ok).toBe(false);
    if (!bad1.ok) {
      expect(bad1.reasonJa).toContain("assets.0.controls.0.status");
      // 項目名の日本語と、英語でない理由
      expect(bad1.reasonJa).toContain("構成要素 1 件目の対策 1 件目の有無");
      expect(bad1.reasonJa).toContain("選べる値ではありません");
      expect(bad1.reasonJa).not.toMatch(/Invalid|expected/);
    }
    const bad2 = parseProfileFile(
      JSON.stringify({
        ...base,
        businesses: [{ id: "b", name: "x", assetIds: [], manualDays: -1, recoveryDays: 0 }],
      }),
    );
    expect(bad2.ok).toBe(false);
    const bad3 = parseProfileFile(JSON.stringify({ ...base, assets: [] }));
    expect(bad3.ok).toBe(false);
    if (!bad3.ok) expect(bad3.reasonJa).toContain("資産が 1 つもありません");
  });
  it("必須の項目が無いときは「必須の項目がありません」と項目名", () => {
    const base = JSON.parse(demoText) as Record<string, unknown>;
    const { pattern: _p, ...noPattern } = base;
    const r = parseProfileFile(JSON.stringify(noPattern));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reasonJa).toContain("pattern（業種の構成パターン）");
      expect(r.reasonJa).toContain("必須の項目がありません");
    }
  });
  it("所有確認（domainVerified）はファイルの値を信用せず false に戻す。ドメインは残す", () => {
    const base = JSON.parse(demoText) as Record<string, unknown>;
    const r = parseProfileFile(
      JSON.stringify({ ...base, domain: "example.jp", domainVerified: true }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.profile.domain).toBe("example.jp");
    expect(r.profile.domainVerified).toBe(false);
    expect(r.notesJa).toContain(EXTERNAL_NOTE_JA);
  });
  it("外部確認の根拠（external）はそのまま持ち込み、注記で知らせる。無ければ注記も無い", () => {
    const r = parseProfileFile(demoText);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 架空企業のカルテには外部確認の根拠が入っている（hostname・exposed が external）
    const vpn = r.profile.assets.find((a) => a.role === "entry.vpn");
    expect(vpn?.attrEvidence.exposed).toBe("external");
    expect(r.notesJa).toEqual([EXTERNAL_NOTE_JA]);
    // external を全部 registered に落とした写しなら注記は無い
    const base = JSON.parse(demoText) as {
      assets: { attrEvidence: Record<string, string>; controls: { evidence: string }[] }[];
    };
    const plain = structuredClone(base);
    for (const a of plain.assets) {
      for (const k of Object.keys(a.attrEvidence))
        if (a.attrEvidence[k] === "external") a.attrEvidence[k] = "registered";
      for (const c of a.controls) if (c.evidence === "external") c.evidence = "registered";
    }
    const r2 = parseProfileFile(JSON.stringify(plain));
    expect(r2.ok && r2.notesJa).toEqual([]);
  });
  it("巨大なファイル（2MB 超）と深すぎる入れ子を拒む", () => {
    const base = JSON.parse(demoText) as Record<string, unknown>;
    const huge = JSON.stringify({ ...base, $comment: "x".repeat(2_000_001) });
    const r1 = parseProfileFile(huge);
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.reasonJa).toContain("大きすぎます");
    // 知らない項目（looseObject が残す）の中に深い入れ子を作る
    let deep: unknown = 1;
    for (let i = 0; i < MAX_DEPTH + 5; i++) deep = [deep];
    const r2 = parseProfileFile(JSON.stringify({ ...base, $deep: deep }));
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.reasonJa).toContain("入れ子が深すぎます");
    // カルテそのものの深さは上限に収まる
    expect(jsonDepth(base)).toBeLessThanOrEqual(MAX_DEPTH);
    expect(jsonDepth({ a: [{ b: 1 }] })).toBe(3);
    expect(jsonDepth("x")).toBe(0);
  });
  it("業務や個人情報がカルテに無い資産を指していれば拒む", () => {
    const base = JSON.parse(demoText) as { businesses: { assetIds: string[] }[] };
    const businesses = structuredClone(base.businesses);
    businesses[0]?.assetIds.push("ghost");
    const r = parseProfileFile(JSON.stringify({ ...base, businesses }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasonJa).toContain("ghost");
  });
});

describe("pathJa（zod の path を日本語の項目名に）", () => {
  it("点つなぎの path と、日本語の項目名（配列は n 件目）を添える", () => {
    expect(pathJa(["assets", 1, "controls", 0, "status"])).toBe(
      "assets.1.controls.0.status（構成要素 2 件目の対策 1 件目の有無）",
    );
    expect(pathJa(["companyName"])).toBe("companyName（会社名）");
    expect(pathJa(["unknownKey"])).toBe("unknownKey（unknownKey）");
    expect(pathJa([])).toBe("（全体）");
  });
});

describe("exportFileName", () => {
  it("会社名と日付を含み、ファイル名に使えない文字と空白を除く", () => {
    const p = { companyName: "テスト製作所 / 本社:工場?" } as CompanyProfile;
    expect(exportFileName(p, new Date(2026, 10, 2))).toBe(
      "ウチダイ-カルテ-テスト製作所本社工場-2026-11-02.json",
    );
    expect(exportFileName({ companyName: "   " } as CompanyProfile, new Date(2026, 0, 5))).toBe(
      "ウチダイ-カルテ-会社-2026-01-05.json",
    );
  });
});
