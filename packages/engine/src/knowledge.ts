/**
 * 知識ファイル（knowledge/）と会社カルテ（examples/）の読み込みと検証
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import {
  AttackData,
  AttrValue,
  CompanyProfile,
  ControlPatch,
  ControlStatus,
  DamageType,
  Layer,
  MitigationId,
  Role,
  Side,
  StepState,
  TacticId,
  TechniqueId,
} from "./types.ts";

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const knowledgeDir = join(repoRoot, "knowledge");

// ---------------------------------------------------------------------------
// 役割・ラベル
// ---------------------------------------------------------------------------
export const RoleDef = z.object({
  id: Role,
  labelJa: z.string(),
  layer: Layer,
  side: Side,
  descriptionJa: z.string().optional(),
});
export const RolesFile = z.object({ roles: z.array(RoleDef) });

export const LabelsFile = z.object({
  tactics: z.record(TacticId, z.string()),
  techniques: z.record(TechniqueId, z.string()),
  mitigations: z.record(z.string().regex(/^M\d{4}$/), z.string()),
  custom: z.record(
    z.string().regex(/^UD-\d{2}$/),
    z.object({ labelJa: z.string(), descriptionJa: z.string().optional() }),
  ),
});
export type RoleDef = z.infer<typeof RoleDef>;
export type LabelsFile = z.infer<typeof LabelsFile>;

// ---------------------------------------------------------------------------
// 判定ルール表の条件式 DSL
// ---------------------------------------------------------------------------
export type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | { control: { mitigation: string; status: "present" | "absent" | "unknown" } }
  | {
      attr: {
        key: string;
        equals?: string | number | boolean | undefined;
        missing?: boolean | undefined;
      };
    }
  | { always: true };

export const Condition: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.object({ all: z.array(Condition) }),
    z.object({ any: z.array(Condition) }),
    z.object({ not: Condition }),
    z.object({ control: z.object({ mitigation: MitigationId, status: ControlStatus }) }),
    z.object({
      attr: z.object({
        key: z.string(),
        equals: AttrValue.optional(),
        missing: z.boolean().optional(),
      }),
    }),
    z.object({ always: z.literal(true) }),
  ]),
);

export const RuleOutcome = z.object({
  state: StepState,
  when: Condition.optional(),
  reasonJa: z.string(),
});
export const Rule = z.object({
  id: z.string(),
  role: Role,
  /** 空なら、その役割の既定ルール（手法を問わない） */
  techniques: z.array(TechniqueId),
  materialsJa: z.string(),
  mitigations: z.array(MitigationId),
  ineffective: z
    .array(z.object({ mitigation: MitigationId, when: Condition.optional(), reasonJa: z.string() }))
    .default([]),
  outcomes: z.array(RuleOutcome).min(1),
});
export const RulesFile = z.object({ rules: z.array(Rule) });
export type Rule = z.infer<typeof Rule>;
export type RuleOutcome = z.infer<typeof RuleOutcome>;

// ---------------------------------------------------------------------------
// 型紙
// ---------------------------------------------------------------------------
export const TemplateStage = z.object({
  id: z.string(),
  labelJa: z.string(),
  tactics: z.array(TacticId),
  entry: z.boolean().default(false),
  precondition: z.boolean().default(false),
  human: z.boolean().default(false),
  optional: z.boolean().default(false),
  terminal: z.boolean().default(false),
  /** 役割ごとの典型手法。null は手法を持たない段階（人の判断、到達） */
  byRole: z.record(Role, TechniqueId.nullable()),
  /** 記事に記載された手法として受け入れる ID */
  accepts: z.array(TechniqueId).default([]),
});
export const Template = z.object({
  id: z.string(),
  damageType: DamageType,
  labelJa: z.string(),
  descriptionJa: z.string(),
  stages: z.array(TemplateStage).min(1),
});
export type Template = z.infer<typeof Template>;
export type TemplateStage = z.infer<typeof TemplateStage>;

// ---------------------------------------------------------------------------
// 対策、業種別パターン、5問、入口候補
// ---------------------------------------------------------------------------
export const MeasureDef = z.object({
  id: z.string(),
  labelJa: z.string(),
  mitigation: MitigationId,
  patches: z.array(ControlPatch),
  costJpy: z.number().optional(),
  costJpyPerDevicePerYear: z.number().optional(),
  costSourceJa: z.string().optional(),
  requestToJa: z.string().optional(),
});
export const MeasuresFile = z.object({ measures: z.array(MeasureDef) });
export type MeasureDef = z.infer<typeof MeasureDef>;

export const PatternBusiness = z.object({
  id: z.string(),
  name: z.string(),
  roles: z.array(Role),
  manualDays: z.number().nonnegative(),
  recoveryDays: z.number().nonnegative(),
  recoveryDaysWithBackup: z.number().nonnegative().optional(),
  affectsJa: z.string().optional(),
});
export const Pattern = z.object({
  id: z.enum(["manufacturing", "office", "healthcare"]),
  labelJa: z.string(),
  core: z.object({ labelJa: z.string() }),
  businesses: z.array(PatternBusiness).max(5),
  impact: z.object({ partnerJa: z.string(), reportJa: z.string() }),
});
export type Pattern = z.infer<typeof Pattern>;

export const QuestionsFile = z.object({
  questions: z.array(z.looseObject({ id: z.string(), textJa: z.string() })),
});

export const EntryCandidates = z.object({
  sourceJa: z.string(),
  sourceUrl: z.string(),
  candidates: z.array(z.object({ role: Role, labelJa: z.string(), technique: TechniqueId })),
});
export type EntryCandidates = z.infer<typeof EntryCandidates>;

// ---------------------------------------------------------------------------
// 読み込み
// ---------------------------------------------------------------------------
function readYaml(rel: string): unknown {
  return parseYaml(readFileSync(join(knowledgeDir, rel), "utf8"));
}
function yamlFiles(rel: string): string[] {
  return readdirSync(join(knowledgeDir, rel))
    .filter((f) => f.endsWith(".yaml"))
    .sort()
    .map((f) => join(rel, f));
}

export function loadAttack(): AttackData {
  return AttackData.parse(
    JSON.parse(readFileSync(join(knowledgeDir, "attack/enterprise.json"), "utf8")),
  );
}
export function loadRoles(): RoleDef[] {
  return RolesFile.parse(readYaml("roles.yaml")).roles;
}
export function loadLabels(): LabelsFile {
  return LabelsFile.parse(readYaml("labels.ja.yaml"));
}
export function loadTemplates(): Template[] {
  return yamlFiles("templates").map((f) => Template.parse(readYaml(f)));
}
export function loadRules(): Rule[] {
  return yamlFiles("rules").flatMap((f) => RulesFile.parse(readYaml(f)).rules);
}
export function loadMeasures(): MeasureDef[] {
  return MeasuresFile.parse(readYaml("measures.yaml")).measures;
}
export function loadPatterns(): Pattern[] {
  return yamlFiles("profiles").map((f) => Pattern.parse(readYaml(f)));
}
export function loadEntryCandidates(): EntryCandidates {
  return EntryCandidates.parse(readYaml("entry-candidates.yaml"));
}
export function loadProfile(path: string): CompanyProfile {
  return CompanyProfile.parse(JSON.parse(readFileSync(path, "utf8")));
}

/** 判定に必要な知識をまとめて読む */
export type Knowledge = {
  attack: AttackData;
  roles: RoleDef[];
  labels: LabelsFile;
  templates: Template[];
  rules: Rule[];
  measures: MeasureDef[];
  patterns: Pattern[];
  entryCandidates: EntryCandidates;
};
let cached: Knowledge | undefined;
export function loadKnowledge(): Knowledge {
  cached ??= {
    attack: loadAttack(),
    roles: loadRoles(),
    labels: loadLabels(),
    templates: loadTemplates(),
    rules: loadRules(),
    measures: loadMeasures(),
    patterns: loadPatterns(),
    entryCandidates: loadEntryCandidates(),
  };
  return cached;
}

/** 役割が登録済みか。business.* は動的に許す */
export function isKnownRole(role: string, roles: RoleDef[]): boolean {
  return role === "business" || role.startsWith("business.") || roles.some((r) => r.id === role);
}

/** 廃止された手法 ID を置き換え先に正規化する（存在しなければ undefined） */
export function canonicalTechnique(id: string, attack: AttackData): string | undefined {
  const replaced = attack.revokedBy.find(([old]) => old === id)?.[1];
  const target = replaced ?? id;
  const t = attack.techniques.find((x) => x.id === target);
  return t && !t.revoked ? t.id : undefined;
}

/** 知識ファイルと会社カルテの整合性を検証し、問題の一覧を返す */
export function checkKnowledge(profilePaths: string[]): string[] {
  const problems: string[] = [];
  const attack = loadAttack();
  const roles = loadRoles();
  const labels = loadLabels();

  const techniqueIds = new Set(attack.techniques.map((t) => t.id));
  const tacticIds = new Set(attack.tactics.map((t) => t.id));
  const mitigationIds = new Set(attack.mitigations.map((m) => m.id));
  const knownMitigation = (id: string) =>
    id.startsWith("UD-") ? id in labels.custom : mitigationIds.has(id);
  const knownTechnique = (id: string) => canonicalTechnique(id, attack) !== undefined;

  for (const id of Object.keys(labels.tactics))
    if (!tacticIds.has(id)) problems.push(`labels: 戦術 ${id} は ATT&CK v${attack.version} にない`);
  for (const id of tacticIds)
    if (!labels.tactics[id]) problems.push(`labels: 戦術 ${id} の日本語ラベルがない`);
  for (const id of Object.keys(labels.techniques))
    if (!techniqueIds.has(id))
      problems.push(`labels: 手法 ${id} は ATT&CK v${attack.version} にない`);
  for (const id of Object.keys(labels.mitigations))
    if (!mitigationIds.has(id))
      problems.push(`labels: 緩和策 ${id} は ATT&CK v${attack.version} にない`);

  const dup = roles.map((r) => r.id).filter((id, i, a) => a.indexOf(id) !== i);
  for (const id of dup) problems.push(`roles: ${id} が重複`);

  const collect = <T>(label: string, fn: () => T): T | undefined => {
    try {
      return fn();
    } catch (e) {
      problems.push(`${label}: ${e instanceof Error ? e.message : String(e)}`);
      return undefined;
    }
  };

  const templates = collect("templates", loadTemplates) ?? [];
  for (const t of templates) {
    for (const s of t.stages) {
      for (const [role, tech] of Object.entries(s.byRole)) {
        if (!isKnownRole(role, roles))
          problems.push(`templates/${t.id}: 段階 ${s.id} の役割 ${role} は roles.yaml にない`);
        if (tech && !knownTechnique(tech))
          problems.push(`templates/${t.id}: 段階 ${s.id} の手法 ${tech} は ATT&CK にない`);
        if (tech && !labels.techniques[tech])
          problems.push(`templates/${t.id}: 手法 ${tech} の日本語ラベルがない`);
      }
      for (const tech of s.accepts)
        if (!knownTechnique(tech))
          problems.push(`templates/${t.id}: 段階 ${s.id} の accepts ${tech} は ATT&CK にない`);
      for (const tac of s.tactics)
        if (!tacticIds.has(tac))
          problems.push(`templates/${t.id}: 段階 ${s.id} の戦術 ${tac} は ATT&CK にない`);
    }
  }

  const rules = collect("rules", loadRules) ?? [];
  const ruleIds = rules.map((r) => r.id);
  for (const id of ruleIds.filter((id, i) => ruleIds.indexOf(id) !== i))
    problems.push(`rules: ${id} が重複`);
  for (const r of rules) {
    if (!isKnownRole(r.role, roles))
      problems.push(`rules/${r.id}: 役割 ${r.role} は roles.yaml にない`);
    for (const tech of r.techniques)
      if (!knownTechnique(tech)) problems.push(`rules/${r.id}: 手法 ${tech} は ATT&CK にない`);
    for (const m of r.mitigations)
      if (!knownMitigation(m)) problems.push(`rules/${r.id}: 緩和策 ${m} が未定義`);
    for (const m of r.mitigations)
      if (!m.startsWith("UD-") && !labels.mitigations[m])
        problems.push(`rules/${r.id}: 緩和策 ${m} の日本語ラベルがない`);
    for (const i of r.ineffective)
      if (!knownMitigation(i.mitigation))
        problems.push(`rules/${r.id}: 効かない緩和策 ${i.mitigation} が未定義`);
  }

  const measures = collect("measures", loadMeasures) ?? [];
  for (const m of measures) {
    if (!knownMitigation(m.mitigation))
      problems.push(`measures/${m.id}: 緩和策 ${m.mitigation} が未定義`);
    for (const p of m.patches) {
      if (!isKnownRole(p.role, roles))
        problems.push(`measures/${m.id}: 役割 ${p.role} は roles.yaml にない`);
      if (!knownMitigation(p.mitigation))
        problems.push(`measures/${m.id}: 緩和策 ${p.mitigation} が未定義`);
    }
  }

  const patterns = collect("profiles", loadPatterns) ?? [];
  for (const p of patterns)
    for (const b of p.businesses)
      for (const role of b.roles)
        if (!isKnownRole(role, roles))
          problems.push(`profiles/${p.id}: 業務 ${b.id} の役割 ${role} は roles.yaml にない`);

  const candidates = collect("entry-candidates", loadEntryCandidates);
  for (const c of candidates?.candidates ?? []) {
    if (!isKnownRole(c.role, roles))
      problems.push(`entry-candidates: 役割 ${c.role} は roles.yaml にない`);
    if (!knownTechnique(c.technique))
      problems.push(`entry-candidates: 手法 ${c.technique} は ATT&CK にない`);
  }
  collect("questions", () => QuestionsFile.parse(readYaml("questions.yaml")));

  for (const path of profilePaths) {
    const profile = collect(path, () => loadProfile(path));
    if (!profile) continue;
    const assetIds = new Set(profile.assets.map((a) => a.id));
    for (const a of profile.assets) {
      if (!isKnownRole(a.role, roles))
        problems.push(`${path}: 資産 ${a.id} の役割 ${a.role} は roles.yaml にない`);
      for (const c of a.controls) {
        if (!knownMitigation(c.mitigation))
          problems.push(`${path}: 資産 ${a.id} の緩和策 ${c.mitigation} が未定義`);
        if (c.status === "unknown" && c.evidence !== "none")
          problems.push(`${path}: 資産 ${a.id} の ${c.mitigation} は未確認なのに根拠がある`);
        if (c.status !== "unknown" && c.evidence === "none")
          problems.push(
            `${path}: 資産 ${a.id} の ${c.mitigation} は根拠なしで ${c.status} になっている`,
          );
      }
    }
    for (const b of profile.businesses)
      for (const id of b.assetIds)
        if (!assetIds.has(id)) problems.push(`${path}: 業務 ${b.id} が存在しない資産 ${id} を参照`);
    for (const p of profile.personalData)
      if (!assetIds.has(p.assetId))
        problems.push(`${path}: 個人情報が存在しない資産 ${p.assetId} を参照`);
  }
  return problems;
}

/** knowledge/schemas/ に JSON Schema を書き出すための一覧 */
export const schemaExports = {
  "roles.schema.json": RolesFile,
  "labels.schema.json": LabelsFile,
  "company-profile.schema.json": CompanyProfile,
  "attack.schema.json": AttackData,
  "template.schema.json": Template,
  "rules.schema.json": RulesFile,
  "measures.schema.json": MeasuresFile,
  "pattern.schema.json": Pattern,
  "entry-candidates.schema.json": EntryCandidates,
} as const;
