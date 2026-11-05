/**
 * 知識ファイル（knowledge/）と会社カルテ（examples/）の読み込みと検証
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
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
  OUT_OF_SCOPE,
  PatternId,
  Role,
  Side,
  Site,
  StepState,
  TacticId,
  TechniqueId,
  TimelineEvent,
} from "./types.ts";

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
/**
 * 知識ファイルの置き場。既定はリポジトリの knowledge/。
 * 環境変数 UCHIDAI_KNOWLEDGE_DIR で別の場所（knowledge/ を複製して攻撃や業種を足したもの）に差し替えられる
 */
export const knowledgeDir = process.env.UCHIDAI_KNOWLEDGE_DIR
  ? resolve(process.env.UCHIDAI_KNOWLEDGE_DIR)
  : join(repoRoot, "knowledge");

// ---------------------------------------------------------------------------
// 役割・ラベル
// ---------------------------------------------------------------------------
/** 資産の属性の宣言。判定ルールと対策ボタンが使える属性は、役割ごとにここへ書いたものだけ */
export const AttrDef = z.object({
  type: z.enum(["boolean", "string", "number"]),
  descriptionJa: z.string(),
});
export type AttrDef = z.infer<typeof AttrDef>;
export const RoleDef = z.object({
  id: Role,
  labelJa: z.string(),
  layer: Layer,
  side: Side,
  descriptionJa: z.string().optional(),
  /**
   * この役割から通信で届く役割（構成グラフの通信の線になる）。
   * 型紙の次の段階や AI 攻撃者の経路は、ここでつながっている役割の間でだけ組み立てる
   */
  links: z.array(Role).default([]),
  /** この役割の資産が持てる属性（判定ルールの attr 条件、対策ボタンの attrs で使う名前） */
  attrs: z.record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9]*$/), AttrDef).default({}),
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
/**
 * 記事が装った相手が既定（社長・役員）と違うときの、段階の言い方（TRIAL-B-005）。
 * キーは Case の段階の impersonates の値。判定そのものは変えず、段階の札だけを差し替える
 */
export const StageVariant = z.object({
  labelJa: z.string(),
  breachedJa: z.string().optional(),
  breachedDoneJa: z.string().optional(),
});
export type StageVariant = z.infer<typeof StageVariant>;

export const TemplateStage = z.object({
  id: z.string(),
  labelJa: z.string(),
  /** この段階が突破されたときの画面の札（現在形。「暗号化される」「だまされる」など）。無ければ汎用の「突破される」 */
  breachedJa: z.string().optional(),
  /** 再生中の帯の文（過去形。「バックアップが暗号化されました」の述語） */
  breachedDoneJa: z.string().optional(),
  /**
   * 一枚の文で、この段階を書く完全な文（{node} は資産の名前）。「{node}から資金が流出する」のように、
   * 「{node}が{breachedJa}」では主語と動詞がつながらない段階に持たせる。無ければ「{node}が{breachedJa}」
   */
  sentenceJa: z.string().optional(),
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
  /** 記事が装った相手が社長以外のときの言い方（impersonates の値 → 札）。無ければ labelJa のまま */
  variants: z.record(z.string(), StageVariant).optional(),
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
// 被害の種類（knowledge/damage-types.yaml）。型紙の damageType はここの id を指す
// ---------------------------------------------------------------------------
export const DamageTypeDef = z.object({
  id: DamageType.refine((id) => id !== OUT_OF_SCOPE, "out_of_scope は組み込みなので定義しない"),
  /** 画面に出す名前 */
  labelJa: z.string(),
  /** Claude への出力指示で使う短い言い方 */
  shortJa: z.string(),
  /** Claude が記事を読むときの分類基準 */
  readingHintJa: z.string(),
  /** 時間軸の最初に置く出来事 */
  day0: z.object({
    kind: TimelineEvent.shape.kind,
    labelJa: z.string(),
    sourceJa: z.string().optional(),
    /** 送金額の目安（カルテの typicalTransferJpy）を添える */
    showMoneyLoss: z.boolean().default(false),
  }),
  /** 到達すると送金額の目安を出す種類（なりすまし送金など） */
  reachesMoney: z.boolean().default(false),
  /**
   * 経路が資産に届いたとき、その資産に依存する業務が止まる種類か。
   * 止まらない種類（情報漏えい、乗っ取り、送金詐欺）は、止まる業務・復旧日数・売上影響を空にする。
   * 宣言が無い種類は従来どおり止まる（true）。省略時の true は、新しい種類を足したときの安全側
   */
  stopsOperations: z.boolean().default(true),
});
export const DamageTypesFile = z.object({ damageTypes: z.array(DamageTypeDef).min(1) });
export type DamageTypeDef = z.infer<typeof DamageTypeDef>;

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
  id: PatternId,
  labelJa: z.string(),
  core: z.object({ labelJa: z.string() }),
  // 最大 4 つ。最初の5問の「現場」の業務が加わっても、業務の層の上限（5）に収まる
  businesses: z.array(PatternBusiness).max(4),
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

/**
 * 「現場はありますか？」の選択肢が業務の層に足す「現場の業務」。
 * replaces は、構成パターンに同じ業務（生産ライン、診療など）が既にあるときの業務 ID で、
 * あればその業務を現場の業務に置き換える（重複させない）。無ければ末尾に足す
 */
export const SiteBusiness = z.object({
  name: z.string(),
  roles: z.array(Role).min(1),
  manualDays: z.number().nonnegative(),
  recoveryDays: z.number().nonnegative(),
  recoveryDaysWithBackup: z.number().nonnegative().optional(),
  affectsJa: z.string(),
  replaces: z.array(z.string()).default([]),
});
export type SiteBusiness = z.infer<typeof SiteBusiness>;
export const SiteOption = z.object({
  value: Site,
  labelJa: z.string(),
  /** この選択肢を出す業種（industry の value）。無ければすべての業種 */
  industries: z.array(z.string()).optional(),
  /** 無ければ（事務所のみ）現場の業務を足さない */
  siteBusiness: SiteBusiness.optional(),
});
export type SiteOption = z.infer<typeof SiteOption>;

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
// ---------------------------------------------------------------------------
// 入口の種類（knowledge/entry-kinds.yaml）。記事の入口と会社カルテの入口の資産を、手法 ID でなく種類で対応づける
// ---------------------------------------------------------------------------
export const EntryKindDef = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/, "入口の種類は英小文字・数字・- で書く"),
  labelJa: z.string(),
  /** この種類の入口に当たる役割（roles.yaml）。カルテにこの役割の資産が無ければ「入口は未登録」 */
  roles: z.array(Role).min(1),
  /** この種類の資産を、記事が書いた入口として記載の出所で当てるか（false は入口が絞れない種類。候補として並べる） */
  pinsAsset: z.boolean().default(true),
  /** Claude が記事を読むときの分類基準 */
  readingHintJa: z.string(),
});
export const EntryKindsFile = z.object({ kinds: z.array(EntryKindDef).min(1) });
export type EntryKindDef = z.infer<typeof EntryKindDef>;

// ---------------------------------------------------------------------------
// 被害を受けた側（knowledge/victims.yaml）。記事の被害が記事の会社そのものか、第三者（委託先・提供元など）か
// ---------------------------------------------------------------------------
export const VictimDef = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/, "被害を受けた側は英小文字・数字・- で書く"),
  labelJa: z.string(),
  /** true なら第三者の事故として書く（御社の設備が入口になったとは書かない） */
  thirdParty: z.boolean().default(false),
  /** Claude が記事を読むときの分類基準 */
  readingHintJa: z.string(),
  /** 一枚と画面で「これは〇〇で起きた事故です。」に続ける文。省略は「御社の設備が入口になったのではありません。」 */
  leadNoteJa: z.string().optional(),
  /** 第三者の事故のとき、御社が確認すること（{label} は labelJa に置き換える） */
  checksJa: z.array(z.string()).default([]),
  /** 個人情報の報告について（断定せず「確認が必要」） */
  reportNoteJa: z.string().optional(),
  /** 一枚の対策の一覧に出す助言（measures.yaml の id。判定には使わない） */
  measureIds: z.array(z.string()).default([]),
});
export const VictimsFile = z.object({ victims: z.array(VictimDef).min(1) });
export type VictimDef = z.infer<typeof VictimDef>;

// ---------------------------------------------------------------------------
// 対象外の事故の共通の初動（knowledge/first-actions.yaml）。判定は出さず、固定の文を出す
// ---------------------------------------------------------------------------
export const FirstActionsFile = z.object({
  common: z.array(z.string()).default([]),
  byTechnique: z
    .array(
      z.object({
        id: z.string(),
        labelJa: z.string(),
        /** 記事の段階の手法（ATT&CK の ID の前方一致） */
        techniques: z.array(z.string()).min(1),
        actionsJa: z.array(z.string()).min(1),
      }),
    )
    .default([]),
});
export type FirstActionsFile = z.infer<typeof FirstActionsFile>;

// ---------------------------------------------------------------------------
// 漏えいした情報の種類（knowledge/leak-kinds.yaml）。記事が書く情報の種類ごとの案内
// ---------------------------------------------------------------------------
export const LeakKindDef = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/, "漏えいした情報の種類は英小文字・数字・- で書く"),
  labelJa: z.string(),
  readingHintJa: z.string(),
  noteJa: z.string(),
  sourceIds: z.array(z.string()).default([]),
});
export const LeakKindsFile = z.object({ kinds: z.array(LeakKindDef).min(1) });
export type LeakKindDef = z.infer<typeof LeakKindDef>;

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
  /** 件数が未入力（既定の over1000 のまま）のときの言い方。実際の件数が分かっているかのように書かない */
  labelUnknownCountJa: z.string().optional(),
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
  /** damage_type は、damageTypes に挙げた被害の種類のときだけ置く */
  appliesTo: z.enum([
    "report",
    "insurance",
    "partner",
    "police",
    "damage_type",
    "leak_kind",
    "all",
  ]),
  damageTypes: z.array(DamageType).optional(),
  /** leak_kind は、記事が書く漏えいした情報の種類（leak-kinds.yaml の id）に当たるときだけ置く */
  leakKinds: z.array(z.string()).optional(),
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
// ツール全体の出典（sources.yaml）。画面の「出典」、README、NOTICE はここと食い違わないようにする
// ---------------------------------------------------------------------------
const HttpsUrl = z.url({ protocol: /^https$/ });
export const SourceCategory = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  titleJa: z.string().min(1),
  /** 分類の見出しの下に添える一言（他のファイルへの案内など） */
  noteJa: z.string().optional(),
});
export const SourceItem = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  categoryId: z.string(),
  nameJa: z.string().min(1),
  url: HttpsUrl,
  publisherJa: z.string().min(1),
  /** 利用条件の一言（CC0 1.0、SIL OFL 1.1、MITRE の規約など） */
  licenseJa: z.string().optional(),
  checkedAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  /** このツールで何に使っているか（1 文） */
  usedForJa: z.string().min(1),
  /** 引用の表記や注意 */
  noticeJa: z.string().optional(),
});
export const SourcesFile = z.object({
  categories: z.array(SourceCategory).min(1),
  sources: z.array(SourceItem).min(1),
});
export type SourceCategory = z.infer<typeof SourceCategory>;
export type SourceItem = z.infer<typeof SourceItem>;
export type SourcesFile = z.infer<typeof SourcesFile>;

/** ATT&CK の版を画面で添える項目（版は yaml にべた書きせず、attack/version.json から差し込む） */
export const ATTACK_VERSIONED_SOURCE_IDS: readonly string[] = ["mitre-attack", "mitre-attack-stix"];
const AttackVersionFile = z.object({ version: z.string() });

/** 画面と API に返す形。分類の順に並べ、各項目に ATT&CK の版を差し込む */
export type SourcesView = {
  categories: (SourceCategory & { sources: (SourceItem & { version?: string })[] })[];
};

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
/** questions.yaml の「現場」の選択肢 */
export function loadSites(): SiteOption[] {
  const file = QuestionsFile.parse(readYaml("questions.yaml"));
  const q = file.questions.find((x) => x.id === "site");
  return z.array(SiteOption).parse(q?.options ?? []);
}
/** questions.yaml の「業種」の選択肢と、それが指す構成パターン */
export type IndustryOption = { value: string; labelJa: string; pattern: string };
export function loadIndustries(): IndustryOption[] {
  const file = QuestionsFile.parse(readYaml("questions.yaml"));
  const q = file.questions.find((x) => x.id === "industry");
  return z
    .array(z.object({ value: z.string(), labelJa: z.string(), pattern: z.string() }))
    .parse(q?.options ?? []);
}
export function loadDamageTypes(): DamageTypeDef[] {
  return DamageTypesFile.parse(readYaml("damage-types.yaml")).damageTypes;
}
export function loadLeakKinds(): LeakKindDef[] {
  return LeakKindsFile.parse(readYaml("leak-kinds.yaml")).kinds;
}
export function loadFirstActions(): FirstActionsFile {
  return FirstActionsFile.parse(readYaml("first-actions.yaml"));
}
export function loadVictims(): VictimDef[] {
  return VictimsFile.parse(readYaml("victims.yaml")).victims;
}
export function loadEntryKinds(): EntryKindDef[] {
  return EntryKindsFile.parse(readYaml("entry-kinds.yaml")).kinds;
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
export function loadSources(): SourcesFile {
  return SourcesFile.parse(readYaml("sources.yaml"));
}
export function loadAttackVersion(): string {
  return AttackVersionFile.parse(
    JSON.parse(readFileSync(join(knowledgeDir, "attack/version.json"), "utf8")),
  ).version;
}
/** 出典の一覧を、分類の順に並べて返す（会社カルテや判定は読まない） */
export function sourcesView(
  file: SourcesFile = loadSources(),
  attackVersion = loadAttackVersion(),
) {
  const view: SourcesView = {
    categories: file.categories.map((c) => ({
      ...c,
      sources: file.sources
        .filter((s) => s.categoryId === c.id)
        .map((s) =>
          ATTACK_VERSIONED_SOURCE_IDS.includes(s.id) ? { ...s, version: attackVersion } : s,
        ),
    })),
  };
  return view;
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
  /** 被害の種類（damage-types.yaml） */
  damageTypes: DamageTypeDef[];
  /** 「現場」の選択肢と、それが足す現場の業務 */
  sites: SiteOption[];
  entryCandidates: EntryCandidates;
  /** 入口の種類（entry-kinds.yaml） */
  entryKinds: EntryKindDef[];
  /** 被害を受けた側（victims.yaml） */
  victims: VictimDef[];
  /** 対象外の事故の共通の初動（first-actions.yaml） */
  firstActions: FirstActionsFile;
  /** 漏えいした情報の種類（leak-kinds.yaml） */
  leakKinds: LeakKindDef[];
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
    damageTypes: loadDamageTypes(),
    sites: loadSites(),
    entryCandidates: loadEntryCandidates(),
    entryKinds: loadEntryKinds(),
    victims: loadVictims(),
    firstActions: loadFirstActions(),
    leakKinds: loadLeakKinds(),
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

/** 条件式に出てくる attr の名前を集める */
function attrKeysIn(conds: (Condition | undefined)[]): string[] {
  const keys: string[] = [];
  const walk = (c: Condition | undefined): void => {
    if (!c) return;
    if ("all" in c) c.all.forEach(walk);
    else if ("any" in c) c.any.forEach(walk);
    else if ("not" in c) walk(c.not);
    else if ("attr" in c) keys.push(c.attr.key);
  };
  conds.forEach(walk);
  return keys;
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
  for (const r of roles)
    for (const to of r.links)
      if (!isKnownRole(to, roles))
        problems.push(`roles: ${r.id} の links ${to} は roles.yaml にない`);
  if (!roles.some((r) => r.id === "attacker" && r.links.length > 0))
    problems.push("roles: attacker に links（攻撃者が最初に届く役割）がない");
  // 属性の宣言：役割 → 属性名 → 型。product / version は資産の項目なので宣言不要
  const declaredAttr = (role: string, key: string) =>
    key === "product" ||
    key === "version" ||
    roles.find((r) => r.id === role)?.attrs[key] !== undefined;
  const attrTypeOk = (role: string, key: string, value: unknown) => {
    const t = roles.find((r) => r.id === role)?.attrs[key]?.type;
    return t === undefined || typeof value === t;
  };

  const collect = <T>(label: string, fn: () => T): T | undefined => {
    try {
      return fn();
    } catch (e) {
      problems.push(`${label}: ${e instanceof Error ? e.message : String(e)}`);
      return undefined;
    }
  };

  const entryKinds = collect("entry-kinds", loadEntryKinds) ?? [];
  for (const id of entryKinds.map((k) => k.id).filter((id, i, a) => a.indexOf(id) !== i))
    problems.push(`entry-kinds: ${id} が重複`);
  for (const kind of entryKinds)
    for (const role of kind.roles)
      if (!isKnownRole(role, roles))
        problems.push(`entry-kinds/${kind.id}: 役割 ${role} が roles.yaml にない`);

  const leakKinds = collect("leak-kinds", loadLeakKinds) ?? [];
  for (const id of leakKinds.map((v) => v.id).filter((id, i, a) => a.indexOf(id) !== i))
    problems.push(`leak-kinds: ${id} が重複`);
  const victims = collect("victims", loadVictims) ?? [];
  for (const id of victims.map((v) => v.id).filter((id, i, a) => a.indexOf(id) !== i))
    problems.push(`victims: ${id} が重複`);
  {
    const measureIds = new Set((collect("measures", loadMeasures) ?? []).map((m) => m.id));
    for (const v of victims)
      for (const id of v.measureIds)
        if (!measureIds.has(id))
          problems.push(`victims/${v.id}: 対策 ${id} が measures.yaml にない`);
  }

  const templates = collect("templates", loadTemplates) ?? [];
  const templateIds = templates.map((t) => t.id);
  for (const id of templateIds.filter((id, i) => templateIds.indexOf(id) !== i))
    problems.push(`templates: ${id} が重複`);
  // 被害の型ごとに複数の型紙を持てる。同じ型で priority が同じ型紙は、記事への当てはまりが同数のとき読み込み順で決まる
  const damageTypes = collect("damage-types", loadDamageTypes) ?? [];
  const damageTypeIds = new Set(damageTypes.map((d) => d.id));
  for (const id of damageTypes.map((d) => d.id).filter((id, i, a) => a.indexOf(id) !== i))
    problems.push(`damage-types: ${id} が重複`);
  for (const d of damageTypes) {
    // 業務が止まらない種類が、時間軸の最初に「業務が止まる」を置くと、画面が食い違う
    if (!d.stopsOperations && d.day0.kind === "business_stop")
      problems.push(
        `damage-types/${d.id}: stopsOperations が false なのに day0.kind が business_stop（止まらない種類は別の出来事から始める）`,
      );
  }
  for (const dt of damageTypeIds)
    if (!templates.some((t) => t.damageType === dt))
      problems.push(`templates: 被害の種類 ${dt} の型紙がない`);
  for (const t of templates)
    if (!damageTypeIds.has(t.damageType))
      problems.push(
        `templates/${t.id}: 被害の種類 ${t.damageType} が damage-types.yaml にない（先に定義する）`,
      );
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
    // 条件式の属性名：宣言のない名前は書き間違いで、判定が静かに「未確認」へ流れるため、ここで止める
    for (const key of attrKeysIn([
      ...r.outcomes.map((o) => o.when),
      ...r.ineffective.map((i) => i.when),
    ]))
      if (!declaredAttr(r.role, key))
        problems.push(`rules/${r.id}: 属性 ${key} は roles.yaml の ${r.role} に宣言されていない`);
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
      for (const [key, value] of Object.entries(p.attrs ?? {})) {
        if (!declaredAttr(p.role, key))
          problems.push(
            `measures/${m.id}: 属性 ${key} は roles.yaml の ${p.role} に宣言されていない`,
          );
        else if (!attrTypeOk(p.role, key, value))
          problems.push(`measures/${m.id}: 属性 ${key} の型が roles.yaml の宣言と違う`);
      }
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
  // 業種の選択肢と構成パターン、現場の選択肢の整合
  const questionsFile = collect("questions", () => QuestionsFile.parse(readYaml("questions.yaml")));
  const industryOptions = (questionsFile?.questions.find((q) => q.id === "industry")?.options ??
    []) as { value: string; pattern?: string }[];
  const industryValues = new Set(industryOptions.map((o) => o.value));
  for (const o of industryOptions)
    if (!patterns.some((p) => p.id === o.pattern))
      problems.push(
        `questions/industry: ${o.value} の構成パターン ${o.pattern} が profiles にない`,
      );
  for (const p of patterns)
    if (!industryOptions.some((o) => o.pattern === p.id))
      problems.push(`questions/industry: 構成パターン ${p.id} に対応する業種の選択肢がない`);
  const sites = collect("questions/site", loadSites) ?? [];
  const patternBusinessIds = new Set(patterns.flatMap((p) => p.businesses.map((b) => b.id)));
  for (const s of sites) {
    for (const i of s.industries ?? [])
      if (!industryValues.has(i))
        problems.push(`questions/site: ${s.value} の業種 ${i} が industry にない`);
    for (const role of s.siteBusiness?.roles ?? [])
      if (!isKnownRole(role, roles))
        problems.push(`questions/site: ${s.value} の現場の業務の役割 ${role} は roles.yaml にない`);
    for (const id of s.siteBusiness?.replaces ?? [])
      if (!patternBusinessIds.has(id))
        problems.push(`questions/site: ${s.value} が置き換える業務 ${id} は profiles にない`);
  }
  for (const i of industryValues)
    if (!sites.some((s) => !s.industries || s.industries.includes(i)))
      problems.push(`questions/site: 業種 ${i} に出す現場の選択肢がない`);

  const deadlines = collect("deadlines", loadDeadlines);
  if (deadlines) {
    const sourceIds = new Set(deadlines.sources.map((s) => s.id));
    const ids = deadlines.deadlines.map((d) => d.id);
    for (const id of ids.filter((id, i) => ids.indexOf(id) !== i))
      problems.push(`deadlines: ${id} が重複`);
    for (const d of deadlines.deadlines) {
      if (!sourceIds.has(d.sourceId))
        problems.push(`deadlines/${d.id}: 出典 ${d.sourceId} が sources にない`);
      if (d.appliesTo === "damage_type" && !(d.damageTypes?.length ?? 0))
        problems.push(`deadlines/${d.id}: appliesTo が damage_type のときは damageTypes が必要`);
      for (const dt of d.damageTypes ?? [])
        if (!damageTypeIds.has(dt))
          problems.push(`deadlines/${d.id}: 被害の種類 ${dt} が damage-types.yaml にない`);
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

  const sourcesFile = collect("sources", loadSources);
  if (sourcesFile) {
    const categoryIds = new Set<string>();
    for (const c of sourcesFile.categories) {
      if (categoryIds.has(c.id)) problems.push(`sources: 分類 ${c.id} が重複`);
      categoryIds.add(c.id);
      if (!sourcesFile.sources.some((s) => s.categoryId === c.id))
        problems.push(`sources: 分類 ${c.id} に項目がない`);
    }
    const ids = new Set<string>();
    for (const s of sourcesFile.sources) {
      if (ids.has(s.id)) problems.push(`sources: ${s.id} が重複`);
      ids.add(s.id);
      if (!categoryIds.has(s.categoryId))
        problems.push(`sources/${s.id}: 分類 ${s.categoryId} が categories にない`);
    }
    for (const id of ATTACK_VERSIONED_SOURCE_IDS)
      if (!ids.has(id)) problems.push(`sources: ATT&CK の版を差し込む項目 ${id} がない`);
    // 判定が使っている出典（deadlines.yaml）が、この一覧にも載っていること
    const urls = new Set(sourcesFile.sources.map((s) => s.url));
    for (const s of deadlines?.sources ?? [])
      if (s.url && !urls.has(s.url))
        problems.push(`sources: deadlines の出典 ${s.id}（${s.url}）が sources.yaml にない`);
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
    if (!patterns.some((p) => p.id === profile.pattern))
      problems.push(`${path}: 構成パターン ${profile.pattern} が profiles にない`);
    if (profile.answers) {
      if (!industryValues.has(profile.answers.industry))
        problems.push(`${path}: 業種 ${profile.answers.industry} が questions.yaml にない`);
      if (!sites.some((s) => s.value === profile.answers?.site))
        problems.push(`${path}: 現場 ${profile.answers.site} が questions.yaml にない`);
    }
    for (const a of profile.assets) {
      if (!isKnownRole(a.role, roles))
        problems.push(`${path}: 資産 ${a.id} の役割 ${a.role} は roles.yaml にない`);
      // 宣言のある属性は型を確かめる（宣言のない属性は、外部確認が足す参考情報などとして許す）
      for (const [key, value] of Object.entries(a.attrs))
        if (!attrTypeOk(a.role, key, value))
          problems.push(`${path}: 資産 ${a.id} の属性 ${key} の型が roles.yaml の宣言と違う`);
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
  "damage-types.schema.json": DamageTypesFile,
  "entry-candidates.schema.json": EntryCandidates,
  "entry-kinds.schema.json": EntryKindsFile,
  "victims.schema.json": VictimsFile,
  "first-actions.schema.json": FirstActionsFile,
  "leak-kinds.schema.json": LeakKindsFile,
  "deadlines.schema.json": DeadlinesFile,
  "costs.schema.json": CostsFile,
  "sources.schema.json": SourcesFile,
  "kev-products.schema.json": KevProductsFile,
} as const;
