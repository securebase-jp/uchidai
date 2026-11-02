import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalTechnique, checkKnowledge, loadAttack, repoRoot } from "./knowledge.ts";

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
