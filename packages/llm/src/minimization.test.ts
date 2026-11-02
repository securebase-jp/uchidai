/**
 * データ最小化：Claude に渡す文章に、カルテの生データ（社名・製品名・バージョン・ホスト名・メールアドレス・
 * 資産 ID・CVE・備考・人数や金額などの数値）が混ざらないことを、examples/demo-seiko.json の全フィールドを
 * 総当たりで検査して固定する。渡してよいのは役割の枠（ID と日本語名）、構成パターン、業務名、判定の数値だけ
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildGraph, evaluate, loadKnowledge, loadProfile, repoRoot } from "@uchidai/engine";
import { describe, expect, it } from "vitest";
import { profileBannedTerms } from "./attacker.ts";
import { abstractProfile, leakedTerms, renderAbstracted } from "./attacker-abstract.ts";
import { writerInputFrom } from "./onepager-writer.ts";
import { measureRequestData, vendorRequestData } from "./writer.ts";

const k = loadKnowledge();
const profilePath = join(repoRoot, "examples", "demo-seiko.json");
const profile = loadProfile(profilePath);
const rawJson = JSON.parse(readFileSync(profilePath, "utf8")) as unknown;

type Leaf = { path: string; key: string; value: string | number };

/** JSON の葉（文字列と数値）をパスつきで列挙する */
function leaves(v: unknown, path = ""): Leaf[] {
  if (typeof v === "string" || typeof v === "number")
    return [{ path, key: path.split(".").pop() ?? "", value: v }];
  if (Array.isArray(v)) return v.flatMap((x, i) => leaves(x, `${path}[${i}]`));
  if (v && typeof v === "object")
    return Object.entries(v as Record<string, unknown>).flatMap(([key, x]) =>
      leaves(x, path ? `${path}.${key}` : key),
    );
  return [];
}

/** 列挙や構造の語（固有情報ではない）。値が rendered に現れても問題にしない */
const STRUCTURAL_KEYS = new Set([
  "$comment",
  "kind",
  "side",
  "evidence",
  "status",
  "role",
  "pattern",
  "mitigation",
  "assetIds",
  "assetId",
]);
const roleIds = new Set(k.roles.map((r) => r.id));
const roleSegments = new Set(k.roles.flatMap((r) => r.id.split(".")));
const roleLabels = new Set(k.roles.map((r) => r.labelJa));

function isStructural(leaf: Leaf): boolean {
  if (STRUCTURAL_KEYS.has(leaf.key)) return true;
  // 役割 ID は知見ファイルの語（connectsTo や assetIds が役割 ID を指すことがある）
  if (typeof leaf.value === "string" && roleIds.has(leaf.value)) return true;
  // 役割の日本語名に含まれる一般語（「保守ベンダー」など）は知見ファイルの語
  if (
    typeof leaf.value === "string" &&
    [...roleLabels].some((l) => l.includes(leaf.value as string))
  )
    return true;
  if (leaf.path.startsWith("answers.") || leaf.path.startsWith("attrEvidence")) return true;
  if (/\.attrEvidence\./.test(leaf.path)) return true;
  // 資産 ID が役割 ID（またはその一部）と同じ語なら、役割として現れるのは正当
  if (/^assets\[\d+\]\.id$/.test(leaf.path) && typeof leaf.value === "string")
    return roleIds.has(leaf.value) || roleSegments.has(leaf.value);
  // 資産の表示名が役割の日本語名そのものなら、役割名として現れるのは正当
  if (/^assets\[\d+\]\.label$/.test(leaf.path) && typeof leaf.value === "string")
    return roleLabels.has(leaf.value);
  return false;
}

/** 数値は桁の境界で照合する（M1032 の「2」のような部分一致を拾わない） */
function containsValue(rendered: string, value: string | number): boolean {
  if (typeof value === "number") {
    const re = new RegExp(`(?<![\\d.,])${String(value)}(?![\\d])`);
    const grouped = value.toLocaleString("ja-JP");
    return re.test(rendered) || (grouped !== String(value) && rendered.includes(grouped));
  }
  return value.length >= 2 && rendered.includes(value);
}

function leaks(rendered: string, allow: (leaf: Leaf) => boolean = () => false): string[] {
  return leaves(rawJson)
    .filter((l) => !isStructural(l) && !allow(l))
    .filter((l) => containsValue(rendered, l.value))
    .map((l) => `${l.path}=${String(l.value)}`);
}

describe("抽象化カルテ（AI攻撃者に渡す文章）", () => {
  const graph = buildGraph(profile, k.roles);
  const rendered = renderAbstracted(
    abstractProfile(profile, graph, k.roles, { labels: k.labels, goals: ["core"] }),
  );

  it("カルテの全フィールドを総当たりしても、役割・パターン以外の値が現れない", () => {
    expect(leaks(rendered)).toEqual([]);
  });
  it("leakedTerms（記録時の自己点検）も何も返さない", () => {
    expect(leakedTerms(profile, rendered)).toEqual([]);
  });
  it("備考（noteJa）やメールアドレスが混ざれば leakedTerms が拾う", () => {
    expect(
      leakedTerms(profile, `${rendered}\n保守ツールのログインはパスワードのみ（ベンダー共通）`),
    ).toHaveLength(1);
    expect(leakedTerms(profile, `${rendered}\n連絡先 someone@example.com`)).toContain(
      "メールアドレス",
    );
  });
  it("カルテ由来の禁止語に社名・製品名・バージョン・ホスト名・CVE・ベンダーの連絡先が入る", () => {
    const terms = profileBannedTerms(profile);
    for (const t of [
      "デモ精工株式会社",
      "demo-seiko.example",
      "Fortinet FortiOS",
      "7.0.14",
      "CVE-2024-55591",
      "vpn.demo-seiko.example",
      "campaign2019.demo-seiko.example",
      "vendor@example.com",
      "地域の保守ベンダー（架空）",
    ])
      expect(terms, t).toContain(t);
  });
});

describe("社長向けの一枚の言い換え（Claude に渡す入力）", () => {
  const graph = buildGraph(profile, k.roles);
  const rec = JSON.parse(
    readFileSync(join(repoRoot, "eval", "recordings", "ipa-case-1.with-knowledge.json"), "utf8"),
  ) as { output: unknown };
  const theCase = { ...(rec.output as object), suspiciousInstructions: [] } as Parameters<
    typeof evaluate
  >[0];
  const verdict = evaluate(theCase, profile, { knowledge: k, graph });
  const input = writerInputFrom(verdict, k);
  const rendered = JSON.stringify(input);

  it("役割名・業務名・判定の数値だけで、社名・製品名・ID・人数・売上などは含まない", () => {
    const allowBusiness = (l: Leaf) =>
      /^businesses\[\d+\]\.(name|manualDays|recoveryDays|recoveryDaysWithBackup|affectsJa)$/.test(
        l.path,
      ) || /^personalData\[\d+\]\.descriptionJa$/.test(l.path);
    expect(leaks(rendered, allowBusiness)).toEqual([]);
    expect(rendered).not.toMatch(/T\d{4}|M\d{4}|UD-\d{2}/);
    expect(input.stages.map((s) => s.roleJa)).toContain("VPN装置");
  });
});

describe("依頼文（Claude に渡す資料）", () => {
  const asset = profile.assets.find((a) => a.id === "vpn");
  if (!asset) throw new Error("fixture: vpn asset");
  const names = {
    companyLabel: profile.companyName,
    vendorLabel: profile.vendor?.name,
    assetLabel: `${asset.label}（${asset.product} ${asset.version}、${asset.attrs.hostname}）`,
    staffLabel: "情報システム担当 山田",
  };
  const vendor = JSON.stringify(
    vendorRequestData({
      ...names,
      assetRoleLabel: "VPN装置",
      question: "VPN 装置のソフトウェアは最新ですか",
      choices: ["最新", "古い", "分からない"],
      mitigationId: "M1051",
      mitigationLabel: "ソフトウェアの更新",
      techniqueId: "T1190",
      techniqueLabel: "公開アプリケーションの悪用",
      materialsJa: "カルテ：製品・バージョン、更新の運用",
      deadline: "2026年11月9日",
      answerUrl: "https://example.trycloudflare.com/#/answer/secret-token",
    }),
  );
  const measure = JSON.stringify(
    measureRequestData({
      ...names,
      assetRoleLabel: "VPN装置",
      measureLabel: "VPN装置の更新",
      mitigationId: "M1051",
      mitigationLabel: "ソフトウェアの更新",
      costJa: "ベンダーの見積もり待ち",
      deadline: "2026年11月25日",
    }),
  );

  it("社名・ベンダー名・資産の表示名・担当者名・回答 URL は渡さない（プログラムが後から差し込む）", () => {
    for (const rendered of [vendor, measure]) {
      for (const bad of [
        names.companyLabel,
        names.vendorLabel ?? "",
        names.assetLabel,
        "山田",
        "Fortinet",
        "7.0.14",
        "demo-seiko",
        "trycloudflare",
        "secret-token",
      ])
        expect(rendered, bad).not.toContain(bad);
      expect(leaks(rendered)).toEqual([]);
    }
  });
});
