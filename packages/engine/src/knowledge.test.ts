import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  canonicalTechnique,
  checkKnowledge,
  knowledgeDir,
  loadAttack,
  loadAttackVersion,
  loadCosts,
  loadDeadlines,
  loadEntryCandidates,
  loadSources,
  repoRoot,
  SourceItem,
  SourcesFile,
  sourcesView,
} from "./knowledge.ts";

describe("knowledge", () => {
  it("知識ファイルとデモ用カルテが整合している", () => {
    expect(checkKnowledge([join(repoRoot, "examples", "demo-seiko.json")])).toEqual([]);
  });
  it("廃止された手法 ID を置き換え先に正規化する", () => {
    const attack = loadAttack();
    expect(canonicalTechnique("T1656", attack)).toBe("T1684.001");
    expect(canonicalTechnique("T1190", attack)).toBe("T1190");
    expect(canonicalTechnique("T9999", attack)).toBeUndefined();
  });
});

describe("sources.yaml（ツール全体の出典）", () => {
  const file = loadSources();

  it("スキーマに合い、URL はすべて https", () => {
    expect(SourcesFile.safeParse(file).success).toBe(true);
    for (const s of file.sources) expect(new URL(s.url).protocol).toBe("https:");
    expect(SourceItem.safeParse({ ...file.sources[0], url: "http://example.com/" }).success).toBe(
      false,
    );
  });
  it("分類の順に並べ、どの項目もどれかの分類に入る", () => {
    const view = sourcesView(file, "20.0");
    expect(view.categories.map((c) => c.id)).toEqual([
      "attack",
      "cases-costs",
      "law-stats",
      "kev",
      "recon",
      "fonts-voice",
    ]);
    expect(view.categories.flatMap((c) => c.sources)).toHaveLength(file.sources.length);
  });
  it("ATT&CK の版は version.json から差し込み、yaml にはべた書きしない", () => {
    const view = sourcesView();
    const attack = view.categories.find((c) => c.id === "attack");
    expect(attack?.sources.map((s) => s.version)).toEqual([
      loadAttackVersion(),
      loadAttackVersion(),
    ]);
    expect(loadAttackVersion()).toBe(loadAttack().version);
    expect(readFileSync(join(knowledgeDir, "sources.yaml"), "utf8")).not.toMatch(
      new RegExp(`v?${loadAttackVersion().replace(".", "\\.")}(?!\\d)`),
    );
    // ATT&CK 以外の項目には版を付けない
    const others = view.categories.filter((c) => c.id !== "attack").flatMap((c) => c.sources);
    expect(others.every((s) => s.version === undefined)).toBe(true);
  });
  it("deadlines.yaml の出典の URL がすべて sources.yaml にも載っている", () => {
    const urls = new Set(file.sources.map((s) => s.url));
    const withUrl = loadDeadlines().sources.filter((s) => s.url);
    expect(withUrl.length).toBeGreaterThan(0);
    for (const s of withUrl) expect(urls.has(s.url as string), `${s.id} ${s.url}`).toBe(true);
  });
  it("costs.yaml と entry-candidates.yaml の出典の URL も載っている", () => {
    const urls = new Set(file.sources.map((s) => s.url));
    expect(urls.has(loadCosts().sourceUrl)).toBe(true);
    expect(urls.has(loadEntryCandidates().sourceUrl)).toBe(true);
  });
});
