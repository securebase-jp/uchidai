/**
 * 正解データ（eval/cases）の形と ID の実在。中身の正しさは開発者が確定する（status: draft のまま）
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalTechnique, loadAttack } from "@uchidai/engine";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { GoldCaseSchema } from "./types.ts";

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, "..", "cases");
const attack = loadAttack();
const cases = readdirSync(dir)
  .filter((f) => f.endsWith(".yaml"))
  .map((f) => GoldCaseSchema.parse(parseYaml(readFileSync(join(dir, f), "utf8"))));

describe("正解データ", () => {
  it("5 件あり、id がファイル名と一致し、重複しない", () => {
    expect(cases.length).toBeGreaterThanOrEqual(5);
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
  });
  it("戦術 ID と手法 ID が取り込んだ ATT&CK に実在する（廃止 ID は置き換え先がある）", () => {
    const tactics = new Set(attack.tactics.map((t) => t.id));
    for (const c of cases)
      for (const s of c.expected.steps) {
        expect(tactics.has(s.tactic), `${c.id}: ${s.tactic}`).toBe(true);
        for (const id of s.techniques)
          expect(canonicalTechnique(id, attack), `${c.id}: ${id}`).toBeDefined();
      }
  });
  it("デモで使う事例には結論（verdict）がある", () => {
    for (const c of cases)
      if (c.expected.usedInDemo) expect(c.expected.verdict, c.id).toBeDefined();
  });
});
