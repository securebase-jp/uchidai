/**
 * ランサムウェアの型紙の任意の枝：永続化・探索・遠隔操作・ログ消去（TRIAL-R-005）。
 * 記事に書かれたときだけ経路に入り、入れても結論・影響・本線は変わらない（持ち出しの枝と同じ仕組み）。
 * 記事に無ければ、これまでの経路と一字一句同じ
 */
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { evaluate } from "./evaluate.ts";
import { type Knowledge, loadKnowledge, loadProfile, repoRoot } from "./knowledge.ts";
import { applyMeasures } from "./measures.ts";
import { effectiveMeasures } from "./onepager.ts";
import type { Case, CompanyProfile } from "./types.ts";

type Step = Case["steps"][number];
const entry: Step = { tactic: "TA0001", techniques: ["T1190"], source: "stated" };
const creds: Step = { tactic: "TA0006", techniques: ["T1003"], source: "stated" };
const lateral: Step = { tactic: "TA0008", techniques: ["T1021.002"], source: "stated" };
const encrypt: Step = { tactic: "TA0040", techniques: ["T1486"], source: "stated" };
const persist: Step = { tactic: "TA0003", techniques: ["T1136.002"], source: "stated" };
const discover: Step = { tactic: "TA0007", techniques: ["T1135", "T1018"], source: "stated" };
const remote: Step = { tactic: "TA0011", techniques: ["T1219"], source: "stated" };
const evade: Step = { tactic: "TA0005", techniques: ["T1070"], source: "stated" };
const make = (steps: Step[]): Case => ({
  title: "VPN から侵入され、管理者アカウントを作られ、ログを消されて暗号化された",
  damageType: "ransomware",
  clarity: "clear",
  suspiciousInstructions: [],
  steps,
});
const withBranches = make([entry, creds, persist, lateral, discover, remote, evade, encrypt]);
const plain = make([entry, creds, lateral, encrypt]);

let k: Knowledge;
let seiko: CompanyProfile;
beforeAll(() => {
  k = loadKnowledge();
  seiko = loadProfile(join(repoRoot, "examples", "demo-seiko.json"));
});

describe("ランサムウェアの任意の枝", () => {
  it("枝の段階は optional・branch で、手法は ATT&CK にあり、ラベルがある", () => {
    const t = k.templates.find((x) => x.id === "ransomware");
    const ids = ["persist", "discover", "remote", "evade"];
    for (const id of ids) {
      const s = t?.stages.find((x) => x.id === id);
      expect(s?.branch, id).toBe(true);
      expect(s?.optional, id).toBe(true);
      for (const tech of [...Object.values(s?.byRole ?? {}), ...(s?.accepts ?? [])]) {
        if (!tech) continue;
        expect(
          k.attack.techniques.some((x) => x.id === tech && !x.revoked),
          tech,
        ).toBe(true);
        expect(k.labels.techniques[tech], tech).toBeDefined();
      }
    }
    // 本線の段階の並びは変わらない
    expect(t?.stages.filter((s) => !s.branch).map((s) => s.id)).toEqual([
      "entry",
      "credentials",
      "lateral",
      "recovery",
      "encrypt",
    ]);
  });

  it("記事に無いときは、枝の段階は経路に入らない", () => {
    const v = evaluate(plain, seiko, { knowledge: k });
    const ids = v.paths.flatMap((p) => p.steps.map((s) => s.stageId));
    for (const id of ["persist", "discover", "remote", "evade", "exfil"])
      expect(ids, id).not.toContain(id);
  });

  it("記事に書かれていれば、枝の段階が記載の出所で経路に入る。結論と影響は変わらない", () => {
    const a = evaluate(plain, seiko, { knowledge: k });
    const b = evaluate(withBranches, seiko, { knowledge: k });
    const path = b.paths[0];
    const branchSteps = path?.steps.filter((s) => s.branch) ?? [];
    expect(branchSteps.map((s) => s.stageId)).toEqual(["persist", "discover", "remote", "evade"]);
    expect(branchSteps.map((s) => s.source)).toEqual(["stated", "stated", "stated", "stated"]);
    expect(branchSteps.map((s) => s.technique)).toEqual(["T1136.002", "T1135", "T1219", "T1070"]);
    // 本線の判定・結論・影響はそのまま
    expect(b.result).toBe(a.result);
    expect(b.headlineJa).toBe(a.headlineJa);
    expect(b.impact).toEqual(a.impact);
    expect(path?.reachedCore).toBe(a.paths[0]?.reachedCore);
    const mainOf = (v: typeof a) =>
      v.paths[0]?.steps.filter((s) => !s.branch).map((s) => [s.stageId, s.role, s.state]);
    expect(mainOf(b)).toEqual(mainOf(a));
  });

  it("枝の段階が止まっても、本線は進む。対策ボタンは枝の段階がある記事にだけ並ぶ", () => {
    const profile = applyMeasures(seiko, [
      ...k.measures.filter((m) => ["admin-account-monitor", "log-offsite"].includes(m.id)),
    ]);
    const v = evaluate(withBranches, profile, { knowledge: k });
    const states = Object.fromEntries(
      (v.paths[0]?.steps ?? []).filter((s) => s.branch).map((s) => [s.stageId, s.state]),
    );
    expect(states.persist).toBe("blocked");
    expect(states.evade).toBe("blocked");
    expect(states.discover).toBe("breached");
    expect(v.paths[0]?.reachedCore).toBe(true);

    const ids = (c: Case) =>
      effectiveMeasures(evaluate(c, seiko, { knowledge: k }), k.measures, seiko).map(
        (e) => e.measure.id,
      );
    for (const id of ["admin-account-monitor", "egress-restrict", "log-offsite"]) {
      expect(ids(withBranches), id).toContain(id);
      expect(ids(plain), id).not.toContain(id);
    }
    // 探索は予防で止められないので、対策ボタンはない
    expect(k.measures.some((m) => m.id.includes("discover"))).toBe(false);
  });
});
