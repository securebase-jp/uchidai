/**
 * 知識ファイル（knowledge/）と会社カルテ（examples/）の読み込みと検証
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { compareVersions, KevProductsFile, loadKevProducts } from "./kev.ts";
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
  TimelineEvent,
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
  /**
   * 本線から枝分かれする段階（二重恐喝の持ち出しなど）。
   * 記事の段階に対応づいたときだけ経路に入れ、この段階が止まっても本線（暗号化など）は先へ進む
   */
  branch: z.boolean().default(false),
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
  /** 同じ被害の型の型紙で、記事の段階の対応づけが同数のときに優先する順（大きいほど優先。既定 0） */
  priority: z.number().int().default(0),
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
  /** 5問から作るカルテに入れる個人情報の既定値 */
  personalData: z
    .array(
      z.object({
        role: Role,
        descriptionJa: z.string(),
        sensitive: z.boolean(),
        over1000: z.boolean(),
      }),
    )
    .default([]),
});
export type Pattern = z.infer<typeof Pattern>;

export const QuestionsFile = z.object({
  questions: z.array(z.looseObject({ id: z.string(), textJa: z.string() })),
});

export const EntryCandidate = z.object({
  role: Role,
  labelJa: z.string(),
  technique: TechniqueId,
  /** 出典の統計での件数（区分がなく件数が公表されていない候補は省略） */
  stat: z
    .object({
      categoryJa: z.string(),
      count: z.number().int().nonnegative(),
      total: z.number().int().positive(),
    })
    .optional(),
  noteJa: z.string().optional(),
});
export const EntryCandidates = z.object({
  sourceJa: z.string(),
  sourceUrl: z.string(),
  mirrorUrl: z.string().optional(),
  surveyJa: z.string().optional(),
  fiveYear: z.record(z.string(), z.number()).optional(),
  candidates: z.array(EntryCandidate).min(1),
});
export type EntryCandidate = z.infer<typeof EntryCandidate>;
export type EntryCandidates = z.infer<typeof EntryCandidates>;

// ---------------------------------------------------------------------------
// 法令・実務上の期限（deadlines.yaml）と対策費用の目安（costs.yaml）
// ---------------------------------------------------------------------------
export const DeadlineSource = z.object({
  id: z.string(),
  nameJa: z.string(),
  url: z.string().optional(),
  checkedAt: z.string(),
  noteJa: z.string().optional(),
});
/** 報告義務の判定条件。到達した個人情報に当てはめる */
export const ReportTrigger = z.object({
  id: z.string(),
  ruleJa: z.string(),
  labelJa: z.string(),
  when: z.enum(["sensitive", "unauthorizedAccess", "over1000"]),
  sourceId: z.string(),
});
export const Deadline = z.object({
  id: z.string(),
  kind: TimelineEvent.shape.kind,
  labelJa: z.string(),
  /** 発覚日からの日数（上限の目安） */
  days: z.number().nonnegative().optional(),
  /** 幅がある場合の下限（速報の 3〜5 日など） */
  daysFrom: z.number().nonnegative().optional(),
  /** 不正の目的によるおそれがある場合の日数（確報の 60 日） */
  daysIfUnauthorized: z.number().nonnegative().optional(),
  /** 日数をカルテから取る項目 */
  daysFromProfile: z.enum(["cyberInsurance.notifyWithinDays"]).optional(),
  /** 日数ではなく出来事に相対して置く */
  placement: z.enum(["before_partner_impact"]).optional(),
  appliesTo: z.enum(["report", "insurance", "partner", "police", "bec", "all"]),
  basisJa: z.string(),
  sourceId: z.string(),
  status: z.enum(["confirmed", "unverified"]),
  noteJa: z.string().optional(),
});
export const DeadlinesFile = z.object({
  checkedAt: z.string(),
  sources: z.array(DeadlineSource).min(1),
  reportTriggers: z.array(ReportTrigger).min(1),
  deadlines: z.array(Deadline).min(1),
});
export type DeadlineSource = z.infer<typeof DeadlineSource>;
export type ReportTrigger = z.infer<typeof ReportTrigger>;
export type Deadline = z.infer<typeof Deadline>;
export type DeadlinesFile = z.infer<typeof DeadlinesFile>;

export const UnitPrice = z.object({
  id: z.string(),
  labelJa: z.string(),
  unitJpy: z.number().nonnegative(),
  per: z.enum(["device_year", "person", "company", "service"]),
  pageJa: z.string(),
});
export const CostEntry = z.object({
  measureId: z.string(),
  /** ipa = 出典の単価で計算、quote = ベンダーの見積もり待ち、internal = 社内ルールで外部費用なし */
  basis: z.enum(["ipa", "quote", "internal"]),
  unitPriceId: z.string().optional(),
  quantity: z.enum(["devices", "people", "company"]).optional(),
  noteJa: z.string().optional(),
});
export const CostsFile = z.object({
  sourceJa: z.string(),
  sourceUrl: z.string(),
  checkedAt: z.string(),
  unitPrices: z.array(UnitPrice),
  measures: z.array(CostEntry),
});
export type UnitPrice = z.infer<typeof UnitPrice>;
export type CostEntry = z.infer<typeof CostEntry>;
export type CostsFile = z.infer<typeof CostsFile>;

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
export function loadDeadlines(): DeadlinesFile {
  return DeadlinesFile.parse(readYaml("deadlines.yaml"));
}
export function loadCosts(): CostsFile {
  return CostsFile.parse(readYaml("costs.yaml"));
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
  deadlines: DeadlinesFile;
  costs: CostsFile;
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
    deadlines: loadDeadlines(),
    costs: loadCosts(),
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
  const templateIds = templates.map((t) => t.id);
  for (const id of templateIds.filter((id, i) => templateIds.indexOf(id) !== i))
    problems.push(`templates: ${id} が重複`);
  // 被害の型ごとに複数の型紙を持てる。同じ型で priority が同じ型紙は、記事への当てはまりが同数のとき読み込み順で決まる
  for (const dt of ["ransomware", "bec", "data_breach"] as const)
    if (!templates.some((t) => t.damageType === dt))
      problems.push(`templates: 被害の型 ${dt} の型紙がない`);
  for (const t of templates) {
    if (t.stages.filter((s) => s.entry).length !== 1)
      problems.push(`templates/${t.id}: 入口（entry）の段階はちょうど 1 つにする`);
    if (!t.stages.some((s) => s.terminal))
      problems.push(`templates/${t.id}: 終点（terminal）の段階がない`);
    for (const s of t.stages) {
      if (s.branch && s.terminal)
        problems.push(`templates/${t.id}: 段階 ${s.id} は枝（branch）と終点を兼ねられない`);
      if (s.branch && s.entry)
        problems.push(`templates/${t.id}: 段階 ${s.id} は枝（branch）と入口を兼ねられない`);
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
  const hasRule = (role: string, tech: string | null) =>
    rules.some(
      (r) =>
        r.role === role &&
        (r.techniques.length === 0 ||
          (tech !== null &&
            (r.techniques.includes(tech) ||
              r.techniques.some((t) => (t.split(".")[0] ?? t) === (tech.split(".")[0] ?? tech))))),
    );
  // 型紙の全段階（役割 × 典型手法）に判定ルールがあること
  for (const t of templates)
    for (const s of t.stages)
      for (const [role, tech] of Object.entries(s.byRole))
        if (!hasRule(role, tech))
          problems.push(
            `rules: 型紙 ${t.id} の段階 ${s.id}（${role} × ${tech ?? "手法なし"}）に判定ルールがない`,
          );
  for (const r of rules) {
    const last = r.outcomes[r.outcomes.length - 1];
    if (last?.when) problems.push(`rules/${r.id}: 最後の outcome は条件なし（既定値）にする`);
    // 止まる状態（blocked、recoverable、human）は確定した対策か属性を条件にする。評価関数も未確認に落とすが、ルールの書き方で守る
    for (const o of r.outcomes)
      if (!o.when && (o.state === "blocked" || o.state === "recoverable" || o.state === "human"))
        problems.push(
          `rules/${r.id}: 条件なしで ${o.state} にしてはいけない（未確認は止まる扱いにしない）`,
        );
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
    if (!hasRule(c.role, c.technique))
      problems.push(`rules: 入口候補（${c.role} × ${c.technique}）に判定ルールがない`);
    if (c.stat && c.stat.count > c.stat.total)
      problems.push(
        `entry-candidates: ${c.role} の件数 ${c.stat.count} が有効回答 ${c.stat.total} を超える`,
      );
  }
  collect("questions", () => QuestionsFile.parse(readYaml("questions.yaml")));

  const deadlines = collect("deadlines", loadDeadlines);
  if (deadlines) {
    const sourceIds = new Set(deadlines.sources.map((s) => s.id));
    const ids = deadlines.deadlines.map((d) => d.id);
    for (const id of ids.filter((id, i) => ids.indexOf(id) !== i))
      problems.push(`deadlines: ${id} が重複`);
    for (const d of deadlines.deadlines) {
      if (!sourceIds.has(d.sourceId))
        problems.push(`deadlines/${d.id}: 出典 ${d.sourceId} が sources にない`);
      if (d.days === undefined && !d.daysFromProfile && !d.placement)
        problems.push(`deadlines/${d.id}: days、daysFromProfile、placement のいずれかが必要`);
      if (d.daysFrom !== undefined && d.days !== undefined && d.daysFrom > d.days)
        problems.push(`deadlines/${d.id}: daysFrom が days を超える`);
      if (d.status === "unverified" && !(d.noteJa ?? "").includes("要確認"))
        problems.push(`deadlines/${d.id}: 未確認の期限は noteJa に「要確認」と書く`);
    }
    for (const t of deadlines.reportTriggers)
      if (!sourceIds.has(t.sourceId))
        problems.push(`deadlines: 報告条件 ${t.id} の出典 ${t.sourceId} が sources にない`);
  }

  const costs = collect("costs", loadCosts);
  if (costs) {
    const unitIds = new Set(costs.unitPrices.map((u) => u.id));
    const measureIds = new Set(measures.map((m) => m.id));
    const covered = new Set<string>();
    for (const c of costs.measures) {
      if (!measureIds.has(c.measureId))
        problems.push(`costs: 対策 ${c.measureId} は measures.yaml にない`);
      if (covered.has(c.measureId)) problems.push(`costs: 対策 ${c.measureId} が重複`);
      covered.add(c.measureId);
      if (c.basis === "ipa") {
        if (!c.unitPriceId || !unitIds.has(c.unitPriceId))
          problems.push(`costs/${c.measureId}: 出典の単価 ${c.unitPriceId ?? "（なし）"} がない`);
        if (!c.quantity) problems.push(`costs/${c.measureId}: 数量の取り方（quantity）がない`);
      }
    }
    for (const m of measures)
      if (!covered.has(m.id))
        problems.push(`costs: 対策 ${m.id} の費用の扱い（ipa / quote / internal）が未記入`);
    for (const u of costs.unitPrices)
      if (!/PDF \d+ ページ/.test(u.pageJa))
        problems.push(`costs: 単価 ${u.id} の出典ページ（PDF n ページ）が未記入`);
  }

  // KEV の対応表：製品 ID と別名の重複、範囲の向き（from <= to / below）、CVE の重複
  const kev = collect("kev/products", loadKevProducts);
  if (kev) {
    const ids = new Set<string>();
    for (const p of kev.products) {
      if (ids.has(p.id)) problems.push(`kev/products: 製品 ${p.id} が重複`);
      ids.add(p.id);
      const cves = new Set<string>();
      for (const r of p.ranges) {
        if (cves.has(r.cve)) problems.push(`kev/products/${p.id}: ${r.cve} の範囲が重複`);
        cves.add(r.cve);
        for (const a of r.affected) {
          const upper = a.to ?? a.below;
          if (a.from && upper && compareVersions(a.from, upper) > 0)
            problems.push(`kev/products/${p.id}: ${r.cve} の範囲 ${a.from} 〜 ${upper} が逆向き`);
        }
      }
      for (const u of p.unverified)
        if (cves.has(u.cve))
          problems.push(`kev/products/${p.id}: ${u.cve} は範囲表にあるのに未確認にも書かれている`);
    }
  }

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
  "deadlines.schema.json": DeadlinesFile,
  "costs.schema.json": CostsFile,
  "kev-products.schema.json": KevProductsFile,
} as const;
