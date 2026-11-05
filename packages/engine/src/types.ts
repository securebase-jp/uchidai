/**
 * ウチダイの共通の型（並行セッションの契約）
 *
 * 判定ロジックは現実の用語（資産、手法、緩和策、根拠、業務）だけで組み、表示の層と分離する。
 * この型を変えるときは主セッション（S0）で変更し、関係するセッションに知らせる。
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// ATT&CK の ID
// ---------------------------------------------------------------------------
export const TacticId = z.string().regex(/^TA\d{4}$/);
export const TechniqueId = z.string().regex(/^T\d{4}(\.\d{3})?$/);
/** ATT&CK の緩和策（M1032 など）または独自基準（UD-01 など） */
export const MitigationId = z.string().regex(/^(M\d{4}|UD-\d{2})$/);
export type TacticId = z.infer<typeof TacticId>;
export type TechniqueId = z.infer<typeof TechniqueId>;
export type MitigationId = z.infer<typeof MitigationId>;

// ---------------------------------------------------------------------------
// 記事から抽出した事例（packages/llm の出力。照合済みのものだけが engine に入る）
// ---------------------------------------------------------------------------
/**
 * 被害の種類の id。一覧は knowledge/damage-types.yaml が決める（形だけここで見る）。
 * out_of_scope は「攻撃経路では判定できない事故」を表す組み込みの値
 */
export const OUT_OF_SCOPE = "out_of_scope";
export const DamageType = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/, "被害の種類は英小文字・数字・_ で書く");
export const Clarity = z.enum(["clear", "partial", "unknown"]);
export const CaseStepSource = z.enum(["stated", "inferred", "unknown"]);
/**
 * 出来事の確度（記事がその出来事をどう書いているか）。source（記載／推定／不明）とは別の軸。
 * confirmed = 出来事として書いている／possible = 「可能性」「おそれ」「とみられる」「考えられる」／
 * exposed_only = 閲覧できる状態だったが、第三者が取得したかは書いていない／no_trace = 「痕跡は確認されず」など否定／
 * claimed = 攻撃者の主張／not_stated = 記事に書かれていない（入口の方法など）。
 * 省略（undefined）は confirmed と同じ。confirmed 以外は source を stated にしない（verifyCase が下げる）
 */
export const StepCertainty = z.enum([
  "confirmed",
  "possible",
  "exposed_only",
  "no_trace",
  "claimed",
  "not_stated",
]);
export type StepCertainty = z.infer<typeof StepCertainty>;

export const CaseStep = z.object({
  tactic: TacticId,
  techniques: z.array(TechniqueId),
  source: CaseStepSource,
  /** 出来事の確度。省略は confirmed と同じ */
  certainty: StepCertainty.optional(),
  /**
   * 入口の種類（knowledge/entry-kinds.yaml の id）。入口（TA0001）の段階だけ。手法 ID では見分けられない
   * VPN・リモートデスクトップ・保守接続・メールなどを、会社カルテの入口の資産に種類で対応づける。省略は種類が分からない
   */
  entryKind: z
    .string()
    .regex(/^[a-z][a-z0-9-]*$/)
    .optional(),
  /** 持ち出された情報が、すでに公開された（リークサイトへの掲載など）と記事が書いている */
  published: z.boolean().optional(),
  /** 根拠となる記事中の文（原文に実在することを照合済み） */
  quote: z.string().optional(),
  /** 読解が付けた一行の説明（日本語） */
  summaryJa: z.string().optional(),
});
export const Case = z.object({
  url: z.string().optional(),
  title: z.string(),
  damageType: DamageType,
  clarity: Clarity,
  steps: z.array(CaseStep),
  /**
   * 被害を受けた側（knowledge/victims.yaml の id）。記事の会社そのものか、その委託先・取引先・提供元など第三者か。
   * 省略は記事の会社そのもの（従来どおり）
   */
  victim: z
    .string()
    .regex(/^[a-z][a-z0-9-]*$/)
    .optional(),
  /** 記事が書く、漏えいした（可能性がある）情報の種類（knowledge/leak-kinds.yaml の id）。省略は書かれていない */
  leakedData: z.array(z.string().regex(/^[a-z][a-z0-9-]*$/)).optional(),
  /** 記事が書く被害額（円）。記事が円で書いているときだけ。御社の想定額（会社カルテ）とは別で、計算には使わない */
  reportedLossJpy: z.number().int().positive().optional(),
  /** 記事の会社は被害を防げた（未遂・送金前に気づいた・被害が出なかった）。省略は被害が出た */
  averted: z.boolean().optional(),
  /** 記事中に指示らしき文があったか（担当者画面に注意を出す） */
  suspiciousInstructions: z.array(z.string()).default([]),
});
export type DamageType = z.infer<typeof DamageType>;
export type Clarity = z.infer<typeof Clarity>;
export type CaseStep = z.infer<typeof CaseStep>;
export type Case = z.infer<typeof Case>;

// ---------------------------------------------------------------------------
// 役割の枠（Role）と層
// ---------------------------------------------------------------------------
/**
 * 役割の枠。型紙と判定ルールはこの枠に対して書き、会社ごとの具体名は Asset.label に持つ。
 * 一覧と既定の層・列は knowledge/roles.yaml に置き、engine が存在を検証する。
 * 例：attacker、entry.vpn、entry.vendor_remote、admin、server、backup、core、cloud.mail_account、
 *     person.accounting、business.*、impact.partner、impact.legal、impact.revenue
 */
export const Role = z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/);
export type Role = z.infer<typeof Role>;

export const Layer = z.enum(["system", "business", "management"]);
/** 社内／社外（クラウド・事業者）／人 */
export const Side = z.enum(["internal", "external", "person"]);
export type Layer = z.infer<typeof Layer>;
export type Side = z.infer<typeof Side>;

// ---------------------------------------------------------------------------
// 会社カルテ（担当者が登録、ベンダー回答で補完）
// ---------------------------------------------------------------------------
/** 根拠の種類。優先順位は external > vendor > registered > none */
export const EvidenceKind = z.enum(["external", "vendor", "registered", "none"]);
export const ControlStatus = z.enum(["present", "absent", "unknown"]);

export const Control = z.object({
  mitigation: MitigationId,
  status: ControlStatus,
  evidence: EvidenceKind,
  /** 補足（例：多要素認証の方式、適用範囲） */
  noteJa: z.string().optional(),
  answeredBy: z.string().optional(),
  answeredAt: z.string().optional(),
});

/** 資産の属性。判定ルールが参照する（例：exposed、alwaysOn、sharedPassword、mfaExceptions） */
export const AttrValue = z.union([z.string(), z.number(), z.boolean()]);

export const Asset = z.object({
  id: z.string(),
  kind: z.enum(["device", "system", "person", "account"]),
  role: Role,
  label: z.string(),
  side: Side.optional(),
  product: z.string().optional(),
  version: z.string().optional(),
  controls: z.array(Control).default([]),
  attrs: z.record(z.string(), AttrValue).default({}),
  /** 属性の根拠（attrs のキーごと） */
  attrEvidence: z.record(z.string(), EvidenceKind).default({}),
});

export const Business = z.object({
  id: z.string(),
  name: z.string(),
  /** この業務が依存する資産 */
  assetIds: z.array(z.string()),
  /** 手作業で回せる日数 */
  manualDays: z.number().nonnegative(),
  /** 復旧にかかる日数 */
  recoveryDays: z.number().nonnegative(),
  /** 切り離したバックアップがある場合の復旧日数 */
  recoveryDaysWithBackup: z.number().nonnegative().optional(),
  /** 影響先の説明（例：取引先の納期） */
  affectsJa: z.string().optional(),
});

export const PersonalData = z.object({
  assetId: z.string(),
  descriptionJa: z.string(),
  count: z.number().int().nonnegative().optional(),
  over1000: z.boolean(),
  /** 要配慮個人情報（病歴など） */
  sensitive: z.boolean(),
});

/** 業種別の構成パターンの id（knowledge/profiles/*.yaml。存在は checkKnowledge が確かめる） */
export const PatternId = z.string().regex(/^[a-z][a-z0-9_]*$/);
export type PatternId = z.infer<typeof PatternId>;

/**
 * 最初の5問の「現場」の値。選択肢とどの業種に出すかは knowledge/questions.yaml が決める
 * （カルテの回答がその選択肢にあるかは checkKnowledge が確かめる）
 */
export const Site = z.string().regex(/^[a-z][a-z0-9_]*$/);
export type Site = z.infer<typeof Site>;

/** 最初の5問の回答。業種の選択肢は knowledge/questions.yaml が決める */
export const ProfileAnswers = z.object({
  industry: z.string().regex(/^[a-z][a-z0-9_]*$/),
  site: Site,
  hosting: z.object({
    mail: z.enum(["onprem", "cloud", "provider", "unknown"]),
    files: z.enum(["onprem", "cloud", "provider", "unknown"]),
    core: z.enum(["onprem", "cloud", "provider", "unknown"]),
    web: z.enum(["onprem", "cloud", "provider", "unknown"]),
  }),
  remoteAccess: z.array(z.enum(["vpn", "rdp", "vendor_remote", "cloud_only", "unknown"])),
  backup: z.enum(["same_network", "cloud_sync", "isolated", "none", "unknown"]),
});

export const CompanyProfile = z.object({
  id: z.string(),
  companyName: z.string(),
  /** 架空の会社かどうか（画面と README に明記する） */
  fictional: z.boolean().default(false),
  domain: z.string().optional(),
  domainVerified: z.boolean().default(false),
  /** 業種別の構成パターン（knowledge/profiles/*.yaml の id） */
  pattern: PatternId,
  answers: ProfileAnswers.optional(),
  /**
   * 5 問の回答だけから作ったカルテ（profileFromAnswers が付ける）。クラウドの共有設定・SaaS・端末管理などの資産は
   * まだ登録されていないので、入口の資産が無くても「御社に入口は無い」とは言えない。詳細に作り込んだカルテには付けない
   */
  coverage: z.literal("answers_only").optional(),
  employees: z.number().int().positive().optional(),
  assets: z.array(Asset),
  businesses: z.array(Business),
  /** 1日あたりの売上（円） */
  dailyRevenue: z.number().nonnegative().optional(),
  personalData: z.array(PersonalData).default([]),
  cyberInsurance: z
    .object({ enrolled: z.boolean(), notifyWithinDays: z.number().int().positive().optional() })
    .optional(),
  /** なりすまし送金で想定する送金額の目安（円）。経営への影響の計算に使う */
  typicalTransferJpy: z.number().nonnegative().optional(),
  vendor: z.object({ name: z.string(), email: z.string().optional() }).optional(),
});
export type EvidenceKind = z.infer<typeof EvidenceKind>;
export type ControlStatus = z.infer<typeof ControlStatus>;
export type Control = z.infer<typeof Control>;
export type Asset = z.infer<typeof Asset>;
export type Business = z.infer<typeof Business>;
export type PersonalData = z.infer<typeof PersonalData>;
export type ProfileAnswers = z.infer<typeof ProfileAnswers>;
export type CompanyProfile = z.infer<typeof CompanyProfile>;

// ---------------------------------------------------------------------------
// 構成グラフ（判定・経路探索・AI攻撃者・描画が共有する）
// ---------------------------------------------------------------------------
export const GraphNode = z.object({
  id: z.string(),
  role: Role,
  label: z.string(),
  layer: Layer,
  side: Side,
  /** 対応する資産・業務（攻撃者ノードや影響先にはない） */
  assetId: z.string().optional(),
  businessId: z.string().optional(),
});
export const EdgeKind = z.enum(["network", "depends", "impacts"]);
export const GraphEdge = z.object({
  id: z.string(),
  from: z.string(),
  to: z.string(),
  kind: EdgeKind,
  labelJa: z.string().optional(),
});
export const Graph = z.object({
  nodes: z.array(GraphNode),
  edges: z.array(GraphEdge),
});
export type GraphNode = z.infer<typeof GraphNode>;
export type GraphEdge = z.infer<typeof GraphEdge>;
export type Graph = z.infer<typeof Graph>;

// ---------------------------------------------------------------------------
// 経路と判定
// ---------------------------------------------------------------------------
/** 段階の状態：止まる、復旧できる、未確認、人次第、突破される */
export const StepState = z.enum(["blocked", "recoverable", "unknown", "human", "breached"]);
/** 線の由来：記事に記載、推定、入口候補、AIが見つけた経路 */
export const PathSource = z.enum(["stated", "inferred", "candidate", "ai"]);

export const PathStep = z.object({
  /** 型紙の段階 ID（AI経路では省略可） */
  stageId: z.string().optional(),
  nodeId: z.string(),
  role: Role,
  tactic: TacticId,
  /** 人の段階（経理担当の判断など）と到達の段階では省略する */
  technique: TechniqueId.optional(),
  /** この段階で効く緩和策 */
  mitigations: z.array(MitigationId),
  /** この経路では効かない緩和策とその理由 */
  ineffective: z.array(z.object({ mitigation: MitigationId, reasonJa: z.string() })).default([]),
  source: PathSource,
  /** 記事から読んだ出来事の確度（記事に対応づいた段階だけ。省略は confirmed と同じ） */
  certainty: StepCertainty.optional(),
  /** 記事が書いた入口の種類（入口の段階だけ） */
  entryKind: z.string().optional(),
  /** 持ち出された情報がすでに公開されたと記事が書いている段階 */
  published: z.boolean().optional(),
  state: StepState,
  evidence: EvidenceKind,
  /** 判定に使ったルール ID と一行の理由 */
  ruleId: z.string().optional(),
  reasonJa: z.string(),
  /** 段階の見出し（型紙の labelJa） */
  labelJa: z.string().optional(),
  /** この段階が突破されたときの札（型紙の breachedJa。現在形。無ければ画面の汎用語「突破される」） */
  breachedLabelJa: z.string().optional(),
  /** 再生中の帯の述語（型紙の breachedDoneJa。過去形。無ければ「突破されました」） */
  breachedDoneJa: z.string().optional(),
  /** 前提条件として表示する段階（止めない） */
  precondition: z.boolean().optional(),
  /** 本線から枝分かれした段階（二重恐喝の持ち出しなど）。止まっても本線は進み、結論の材料にも数えない */
  branch: z.boolean().optional(),
  quote: z.string().optional(),
});

export const AttackPath = z.object({
  id: z.string(),
  templateId: z.string().optional(),
  /** 入口候補の展開で生まれた経路か、AI が見つけた経路か */
  source: PathSource,
  steps: z.array(PathStep),
  /** 中核まで到達したか */
  reachedCore: z.boolean(),
  /** 到達した資産（個人情報の判定に使う） */
  reachedAssetIds: z.array(z.string()),
});

export const Contradiction = z.object({
  assetId: z.string(),
  messageJa: z.string(),
  external: z.string(),
  registered: z.string(),
});

export const TimelineEvent = z.object({
  day: z.number().nonnegative(),
  kind: z.enum(["business_stop", "partner", "legal", "insurance", "police", "recovery", "money"]),
  labelJa: z.string(),
  detailJa: z.string().optional(),
  sourceJa: z.string().optional(),
  /** 対策で消える出来事かどうかの判定に使う */
  businessId: z.string().optional(),
  /** 個人情報の出来事が紐づく資産（到達しなくなれば消える） */
  assetId: z.string().optional(),
  /** knowledge/deadlines.yaml の期限 ID */
  deadlineId: z.string().optional(),
});

export const Impact = z.object({
  stopped: z.array(
    z.object({
      businessId: z.string(),
      name: z.string(),
      days: z.number(),
      manualDays: z.number(),
      /** 取引先に影響が出始める日（手作業で回せる日数 + 1。復旧が手作業の範囲に収まれば無い） */
      partnerDay: z.number().optional(),
      affectsJa: z.string().optional(),
    }),
  ),
  downtimeDays: z.number(),
  /** 取引先に影響が出始める日（止まる業務の最短） */
  partnerImpactDay: z.number().optional(),
  revenueImpactJpy: z.number().optional(),
  moneyLossJpy: z.number().optional(),
  personalDataReached: z.array(PersonalData),
  /** 個人情報保護委員会への報告義務が生じるか */
  reportRequired: z.boolean(),
  /** 報告義務の根拠（knowledge/deadlines.yaml の reportTriggers の labelJa） */
  reportReasonsJa: z.array(z.string()).optional(),
});

/** 結論：止められる／抑えられる／大丈夫ではない／確認中／入口なし／対象外 */
export const VerdictResult = z.enum([
  "blocked",
  "mitigated",
  "breached",
  "pending",
  "no_entry",
  "out_of_scope",
]);

export const Verdict = z.object({
  result: VerdictResult,
  headlineJa: z.string(),
  /** 判定に選んだ型紙（knowledge/templates の id と labelJa）。複数の型紙を展開したときは各経路の templateId を見る */
  templateId: z.string().optional(),
  templateLabelJa: z.string().optional(),
  /**
   * 被害が第三者（委託先・取引先・提供元）に起きた事故のとき。結論は「御社が同じ立場なら」の見立てで、
   * 見出し・一枚・画面を第三者の事故として書き、御社が確認することを添える
   */
  thirdParty: z
    .object({
      id: z.string(),
      labelJa: z.string(),
      checksJa: z.array(z.string()),
      reportNoteJa: z.string().optional(),
      /** 一枚の対策の一覧に出す助言（委託先管理など。判定には使わない） */
      measureIds: z.array(z.string()).default([]),
    })
    .optional(),
  /** 記事が書く事実（被害額、未遂）。御社の想定とは別に、一枚で並べて書く */
  article: z
    .object({
      reportedLossJpy: z.number().optional(),
      averted: z.boolean().optional(),
    })
    .optional(),
  /** 記事が書く、漏えいした情報の種類と、その案内（leak-kinds.yaml から解いたもの） */
  leakedData: z
    .array(z.object({ id: z.string(), labelJa: z.string(), noteJa: z.string() }))
    .optional(),
  /** 判定の対象外だが、利用者が確認できることがあるとき（ソフトウェアの供給網の事故など）の案内 */
  guidanceJa: z.array(z.string()).optional(),
  /**
   * カルテの範囲では入口が見つからないが、5 問から作った既定の枠のカルテなので「入口は無い」とは言えないとき、
   * その案内（result は pending）。登録が足りない可能性があることと、確認してほしいことを書く
   */
  coverageGapJa: z.string().optional(),
  paths: z.array(AttackPath),
  contradictions: z.array(Contradiction),
  timeline: z.array(TimelineEvent),
  impact: Impact,
  attackVersion: z.string(),
});
export type StepState = z.infer<typeof StepState>;
export type PathSource = z.infer<typeof PathSource>;
export type PathStep = z.infer<typeof PathStep>;
export type AttackPath = z.infer<typeof AttackPath>;
export type Contradiction = z.infer<typeof Contradiction>;
export type TimelineEvent = z.infer<typeof TimelineEvent>;
export type Impact = z.infer<typeof Impact>;
export type VerdictResult = z.infer<typeof VerdictResult>;
export type Verdict = z.infer<typeof Verdict>;

// ---------------------------------------------------------------------------
// 対策ボタン（再判定）
// ---------------------------------------------------------------------------
export const ControlPatch = z.object({
  role: Role,
  mitigation: MitigationId,
  status: ControlStatus,
  attrs: z.record(z.string(), AttrValue).optional(),
});
export const Measure = z.object({
  id: z.string(),
  labelJa: z.string(),
  mitigation: MitigationId,
  patches: z.array(ControlPatch),
  costJpy: z.number().optional(),
  costSourceJa: z.string().optional(),
  /** 依頼先（保守ベンダーなど） */
  requestToJa: z.string().optional(),
});
export type ControlPatch = z.infer<typeof ControlPatch>;
export type Measure = z.infer<typeof Measure>;

// ---------------------------------------------------------------------------
// ATT&CK の取り込みデータ（knowledge/attack/enterprise.json）
// ---------------------------------------------------------------------------
export const AttackData = z.object({
  version: z.string(),
  modified: z.string(),
  tactics: z.array(z.object({ id: TacticId, name: z.string(), shortname: z.string() })),
  techniques: z.array(
    z.object({
      id: TechniqueId,
      name: z.string(),
      tactics: z.array(TacticId),
      parent: TechniqueId.optional(),
      revoked: z.boolean(),
      deprecated: z.boolean(),
    }),
  ),
  mitigations: z.array(z.object({ id: MitigationId, name: z.string(), deprecated: z.boolean() })),
  /** [緩和策ID, 手法ID] の組 */
  mitigates: z.array(z.tuple([MitigationId, TechniqueId])),
  /** [廃止された手法ID, 置き換え先の手法ID]。Claude が古い ID（T1656 など）を返しても置き換えて照合する */
  revokedBy: z.array(z.tuple([TechniqueId, TechniqueId])),
});
export type AttackData = z.infer<typeof AttackData>;
