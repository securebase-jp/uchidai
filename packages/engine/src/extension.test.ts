/**
 * 拡張性：新しい攻撃の種類を、コードを変えず知識ファイル（YAML）だけで足せること。
 * 架空の攻撃「会計クラウドの乗っ取り」を足して、判定・時間軸・検査が動くことを確かめる。
 * あわせて、書き間違い（宣言のない属性、未定義の被害の種類）を pnpm knowledge:check が止めること
 */
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { evaluate } from "./evaluate.ts";
import {
  DamageTypeDef,
  type Knowledge,
  loadKnowledge,
  loadProfile,
  RoleDef,
  Rule,
  repoRoot,
  Template,
} from "./knowledge.ts";
import { applyMeasures } from "./measures.ts";
import { buildTimeline } from "./timeline.ts";
import type { Case, CompanyProfile } from "./types.ts";

const engineDir = join(dirname(fileURLToPath(import.meta.url)), "..");

// 架空の攻撃：会計クラウドに不正ログインされ、不正に送金される
const NEW_TYPE = {
  id: "accounting_takeover",
  labelJa: "会計クラウドの乗っ取り",
  shortJa: "会計クラウドの乗っ取り・不正送金",
  readingHintJa: "会計クラウドに不正ログインされ、振込データを書き換えられて送金されたもの",
  day0: { kind: "money", labelJa: "会計クラウドから不正に送金される" },
  reachesMoney: true,
};
const NEW_TEMPLATE = {
  id: "accounting-takeover",
  damageType: "accounting_takeover",
  labelJa: "会計クラウドの乗っ取り",
  descriptionJa:
    "会計クラウドに不正ログインされ、振込データを書き換えられて、経理担当の承認で送金される",
  stages: [
    {
      id: "login",
      labelJa: "会計クラウドに不正ログインされる",
      tactics: ["TA0001"],
      entry: true,
      byRole: { "cloud.accounting": "T1078.004" },
      accepts: ["T1078.004", "T1078"],
    },
    {
      id: "approve",
      labelJa: "経理担当が改ざんされた振込データを承認する",
      tactics: ["TA0002"],
      human: true,
      byRole: { "person.accounting": null },
    },
    {
      id: "money",
      labelJa: "不正に送金される",
      tactics: ["TA0040"],
      byRole: { "impact.money": null },
      terminal: true,
    },
  ],
};
const NEW_RULES = {
  rules: [
    {
      id: "accounting_takeover.login",
      role: "cloud.accounting",
      techniques: ["T1078.004", "T1078"],
      materialsJa: "カルテ：会計クラウドの多要素認証",
      mitigations: ["M1032"],
      outcomes: [
        {
          state: "blocked",
          when: { control: { mitigation: "M1032", status: "present" } },
          reasonJa: "会計クラウドに多要素認証がある",
        },
        {
          state: "unknown",
          when: { control: { mitigation: "M1032", status: "unknown" } },
          reasonJa: "多要素認証が未確認",
        },
        { state: "breached", reasonJa: "パスワードだけでログインできる" },
      ],
    },
  ],
};

/** 既存の知識に、新しい攻撃を足した Knowledge（ファイルを書かず、同じ形式を zod で読んで足す） */
function withNewAttack(base: Knowledge): Knowledge {
  return {
    ...base,
    damageTypes: [...base.damageTypes, DamageTypeDef.parse(NEW_TYPE)],
    templates: [...base.templates, Template.parse(NEW_TEMPLATE)],
    rules: [...base.rules, ...NEW_RULES.rules.map((r) => Rule.parse(r))],
    // 攻撃者が会計クラウドに直接届く、という通信のつながりを足す
    roles: base.roles.map((r) =>
      r.id === "attacker" ? RoleDef.parse({ ...r, links: [...r.links, "cloud.accounting"] }) : r,
    ),
  };
}

const theCase: Case = {
  title: "架空の事例",
  damageType: "accounting_takeover",
  clarity: "clear",
  suspiciousInstructions: [],
  steps: [{ tactic: "TA0001", techniques: ["T1078.004"], source: "stated" }],
};

describe("新しい攻撃を足す（コードの変更なし）", () => {
  let k: Knowledge;
  let demo: CompanyProfile;
  beforeAll(() => {
    k = withNewAttack(loadKnowledge());
    demo = loadProfile(join(repoRoot, "examples", "demo-seiko.json"));
  });

  it("足す前は、その種類の型紙がなく「対象外」になる", () => {
    const v = evaluate(theCase, demo, { knowledge: loadKnowledge() });
    expect(v.result).toBe("out_of_scope");
  });

  /** 会計クラウドの多要素認証の状態だけを変えたカルテ */
  const withAccountingMfa = (status: "present" | "absent" | "unknown") =>
    applyMeasures(demo, [
      {
        id: `accounting-mfa-${status}`,
        labelJa: "会計クラウドの多要素認証",
        patches: [{ role: "cloud.accounting", mitigation: "M1032", status }],
      },
    ]);

  it("型紙・判定ルール・役割のつながりだけで、経路が組み立てられ判定される", () => {
    // デモの会社は会計クラウドに多要素認証がある → 入口で止まる
    const blocked = evaluate(theCase, demo, { knowledge: k });
    expect(blocked.result).toBe("blocked");
    expect(blocked.paths[0]?.templateId).toBe("accounting-takeover");
    expect(blocked.paths[0]?.steps.map((s) => [s.role, s.state])).toEqual([
      ["cloud.accounting", "blocked"],
    ]);

    // 多要素認証が無ければ、会計クラウド → 経理担当（既存の判定ルールを再利用）→ 資金の流出まで進む
    const open = evaluate(theCase, withAccountingMfa("absent"), { knowledge: k });
    expect(open.result).toBe("breached");
    expect(open.paths[0]?.steps.map((s) => s.role)).toEqual([
      "cloud.accounting",
      "person.accounting",
      "impact.money",
    ]);

    // 未確認なら、入口は「止まる」とは判定しない（未確認として残る）
    const unknown = evaluate(theCase, withAccountingMfa("unknown"), { knowledge: k });
    expect(unknown.paths[0]?.steps[0]?.state).toBe("unknown");
    expect(unknown.result).not.toBe("blocked");
  });

  it("対策を入れると止まる。判定ルールの条件がそのまま効く", () => {
    const before = evaluate(theCase, withAccountingMfa("absent"), { knowledge: k });
    const after = evaluate(
      theCase,
      applyMeasures(withAccountingMfa("absent"), [
        {
          id: "accounting-mfa",
          labelJa: "会計クラウドに多要素認証",
          patches: [{ role: "cloud.accounting", mitigation: "M1032", status: "present" }],
        },
      ]),
      { knowledge: k },
    );
    expect([before.result, after.result]).toEqual(["breached", "blocked"]);
  });

  it("役割のつながり（links）を足さないと、入口に届かず「入口なし」になる", () => {
    const noLink: Knowledge = { ...k, roles: loadKnowledge().roles };
    expect(evaluate(theCase, withAccountingMfa("absent"), { knowledge: noLink }).result).toBe(
      "no_entry",
    );
  });

  it("時間軸の最初の出来事は damage-types.yaml の day0、送金額の目安も出る", () => {
    const profile = { ...withAccountingMfa("absent"), typicalTransferJpy: 3_000_000 };
    const v = evaluate(theCase, profile, { knowledge: k });
    expect(v.result).toBe("breached");
    const day0 = buildTimeline(v.impact, profile, v, { knowledge: k }).find((e) => e.day === 0);
    expect(day0?.labelJa).toBe(NEW_TYPE.day0.labelJa);
    expect(day0?.kind).toBe("money");
    expect(v.impact.moneyLossJpy).toBe(3_000_000);
  });
});

describe("書き間違いを knowledge:check が止める", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "uchidai-knowledge-"));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** knowledge/ を複製して、指定の変更を加え、検査を実行する */
  function check(mutate: (root: string) => void): { ok: boolean; output: string } {
    const root = mkdtempSync(join(dir, "k-"));
    cpSync(join(repoRoot, "knowledge"), root, { recursive: true });
    mutate(root);
    const r = spawnSync(
      process.execPath,
      ["--disable-warning=ExperimentalWarning", "scripts/check-knowledge.ts"],
      { cwd: engineDir, env: { ...process.env, UCHIDAI_KNOWLEDGE_DIR: root }, encoding: "utf8" },
    );
    return { ok: r.status === 0, output: `${r.stdout}${r.stderr}` };
  }
  const readYaml = (root: string, rel: string) =>
    parseYaml(readFileSync(join(root, rel), "utf8")) as Record<string, unknown>;
  const writeYaml = (root: string, rel: string, value: unknown) =>
    writeFileSync(join(root, rel), stringifyYaml(value));

  /** 新しい攻撃を YAML ファイルとして足す */
  function addAttackFiles(root: string): void {
    const types = readYaml(root, "damage-types.yaml") as { damageTypes: unknown[] };
    types.damageTypes.push(NEW_TYPE);
    writeYaml(root, "damage-types.yaml", types);
    writeYaml(root, "templates/accounting-takeover.yaml", NEW_TEMPLATE);
    writeYaml(root, "rules/accounting-takeover.yaml", NEW_RULES);
    const roles = readYaml(root, "roles.yaml") as { roles: { id: string; links?: string[] }[] };
    const attacker = roles.roles.find((r) => r.id === "attacker");
    attacker?.links?.push("cloud.accounting");
    writeYaml(root, "roles.yaml", roles);
  }

  it("新しい攻撃を YAML だけで足した知識は、検査を通る", () => {
    const r = check(addAttackFiles);
    expect(r.output).toContain("問題なし");
    expect(r.ok).toBe(true);
  }, 60_000);

  it("宣言のない属性を判定ルールで使うと止まる（書き間違いで判定が黙って変わらないように）", () => {
    const r = check((root) => {
      addAttackFiles(root);
      const rules = readYaml(root, "rules/accounting-takeover.yaml") as {
        rules: { outcomes: { when?: unknown }[] }[];
      };
      const first = rules.rules[0]?.outcomes[0];
      if (first) first.when = { attr: { key: "mfaEnabld", equals: true } };
      writeYaml(root, "rules/accounting-takeover.yaml", rules);
    });
    expect(r.ok).toBe(false);
    expect(r.output).toContain(
      "属性 mfaEnabld は roles.yaml の cloud.accounting に宣言されていない",
    );
  }, 60_000);

  it("damage-types.yaml に無い被害の種類を型紙で使うと止まる", () => {
    const r = check((root) => {
      addAttackFiles(root);
      const t = readYaml(root, "templates/accounting-takeover.yaml");
      t.damageType = "accounting_takeovr";
      writeYaml(root, "templates/accounting-takeover.yaml", t);
    });
    expect(r.ok).toBe(false);
    expect(r.output).toContain("被害の種類 accounting_takeovr が damage-types.yaml にない");
  }, 60_000);

  it("型紙の段階に判定ルールが無いと止まる", () => {
    const r = check((root) => {
      addAttackFiles(root);
      rmSync(join(root, "rules/accounting-takeover.yaml"));
    });
    expect(r.ok).toBe(false);
    expect(r.output).toContain("に判定ルールがない");
  }, 60_000);

  it("roles.yaml の links に未登録の役割を書くと止まる", () => {
    const r = check((root) => {
      const roles = readYaml(root, "roles.yaml") as { roles: { id: string; links?: string[] }[] };
      roles.roles.find((x) => x.id === "pc")?.links?.push("server.typo");
      writeYaml(root, "roles.yaml", roles);
    });
    expect(r.ok).toBe(false);
    expect(r.output).toContain("links server.typo は roles.yaml にない");
  }, 60_000);
});
