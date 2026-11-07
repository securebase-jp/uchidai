/**
 * 経営への影響：到達した資産 → 止まる業務 → 停止日数・取引先への影響が出る日・売上影響・送金額・個人情報の報告義務
 *
 * 数字はすべて会社カルテと固定データ（knowledge/deadlines.yaml）から決定的に計算する。
 * 外部統計からの損害額の推計はしない（売上影響は「1 日あたりの売上 × 停止日数」の目安だけ）。
 */
import { type DeadlinesFile, type Knowledge, loadDeadlines, loadKnowledge } from "./knowledge.ts";
import type {
  AttackPath,
  CompanyProfile,
  DamageType,
  Impact,
  PersonalData,
  Verdict,
} from "./types.ts";

export type ImpactOptions = {
  /** 事例の種類（なりすまし送金なら送金額の目安を出す）。省略時は経路から推定する */
  damageType?: DamageType;
  /** 報告義務の判定条件（省略時は knowledge/deadlines.yaml を読む） */
  deadlines?: DeadlinesFile;
  /** 型紙 ID から事例の種類を引くのに使う */
  knowledge?: Knowledge;
};

export function pathsOf(input: Pick<Verdict, "paths"> | AttackPath[]): AttackPath[] {
  return Array.isArray(input) ? input : input.paths;
}

/** 中核まで到達した経路が通った資産の集合 */
export function reachedAssets(paths: AttackPath[]): Set<string> {
  return new Set(paths.filter((p) => p.reachedCore).flatMap((p) => p.reachedAssetIds));
}

/**
 * 到達した経路のすべてに「復旧できる」段階（切り離したバックアップなど）があるか。
 * 復旧できない経路が一つでも残れば、停止日数は通常の復旧日数で見る（結論 mitigated の条件と同じ）
 */
export function hasRecoverableStep(paths: AttackPath[]): boolean {
  const reached = paths.filter((p) => p.reachedCore);
  return reached.length > 0 && reached.every((p) => p.steps.some((s) => s.state === "recoverable"));
}

/** 経路の型紙 ID から事例の種類を引く */
export function damageTypeOf(
  input: Pick<Verdict, "paths"> | AttackPath[],
  knowledge?: Knowledge,
): DamageType | undefined {
  const first = pathsOf(input).find((p) => p.templateId)?.templateId;
  if (!first) return undefined;
  const templates = knowledge?.templates ?? loadKnowledge().templates;
  return templates.find((x) => x.id === first)?.damageType;
}

/** 到達した個人情報に、報告義務の条件（規則第7条）を当てはめる。攻撃経路による到達はすべて不正アクセス由来とみなす */
export function reportReasons(
  reached: PersonalData[],
  deadlines: DeadlinesFile,
  unauthorizedAccess = true,
): string[] {
  if (reached.length === 0) return [];
  const matches = (when: DeadlinesFile["reportTriggers"][number]["when"]): boolean =>
    when === "sensitive"
      ? reached.some((p) => p.sensitive)
      : when === "over1000"
        ? reached.some((p) => p.over1000)
        : unauthorizedAccess;
  // 1,000 人超の根拠は、件数が分かっているときだけ「超える」と書く。件数が未入力（既定の over1000 のまま）なら、超えるおそれと書く
  const countUnknown = reached.filter((p) => p.over1000).every((p) => p.count === undefined);
  return deadlines.reportTriggers
    .filter((t) => matches(t.when))
    .map((t) =>
      t.when === "over1000" && countUnknown && t.labelUnknownCountJa
        ? t.labelUnknownCountJa
        : t.labelJa,
    );
}

/**
 * 経路（または Verdict）と会社カルテから経営への影響を計算する。
 * - 業務は、依存する資産のどれかに経路が到達したら止まる（recoveryDays が 0 の業務は止まらない）。
 *   ただし被害の種類が業務を止めない（stopsOperations: false。情報漏えいなど）ときは、止まる業務を空にする
 * - 停止日数は復旧日数。到達した経路に「復旧できる」段階があれば recoveryDaysWithBackup
 * - 取引先に影響が出始める日 = 手作業で回せる日数 + 1（復旧が手作業の範囲に収まればなし）
 * - 売上影響の目安 = 1 日あたりの売上 × 最長の停止日数
 * - 送金額の目安 = カルテの typicalTransferJpy（なりすまし送金で資金の流出に到達したとき）
 */
export function computeImpact(
  input: Pick<Verdict, "paths"> | AttackPath[],
  profile: CompanyProfile,
  options: ImpactOptions = {},
): Impact {
  const paths = pathsOf(input);
  const reachedPaths = paths.filter((p) => p.reachedCore);
  const reached = reachedAssets(paths);
  const recoverable = hasRecoverableStep(paths);
  const deadlines = options.deadlines ?? options.knowledge?.deadlines ?? loadDeadlines();
  const damageType = options.damageType ?? damageTypeOf(paths, options.knowledge);

  // 業務が止まるかは被害の種類が決める（knowledge/damage-types.yaml の stopsOperations）。
  // 暗号化は止まるが、情報漏えいは経路がサーバに届いても業務は止まらない。宣言が無い種類・種類が分からないときは止まる
  const damageTypeDefs = options.knowledge?.damageTypes ?? loadKnowledge().damageTypes;
  const stopsOperations = damageTypeDefs.find((d) => d.id === damageType)?.stopsOperations ?? true;

  const stopped = profile.businesses
    .filter(
      (b) => stopsOperations && b.recoveryDays > 0 && b.assetIds.some((id) => reached.has(id)),
    )
    .map((b) => {
      const days =
        recoverable && b.recoveryDaysWithBackup !== undefined
          ? b.recoveryDaysWithBackup
          : b.recoveryDays;
      const partnerDay = days > b.manualDays ? b.manualDays + 1 : undefined;
      return {
        businessId: b.id,
        name: b.name,
        days,
        manualDays: b.manualDays,
        ...(partnerDay !== undefined ? { partnerDay } : {}),
        ...(b.affectsJa ? { affectsJa: b.affectsJa } : {}),
      };
    });
  const downtimeDays = stopped.reduce((m, s) => Math.max(m, s.days), 0);
  const partnerDays = stopped.map((s) => s.partnerDay).filter((d): d is number => d !== undefined);
  const partnerImpactDay = partnerDays.length > 0 ? Math.min(...partnerDays) : undefined;

  const reportsPersonalData =
    damageTypeDefs.find((d) => d.id === damageType)?.reportsPersonalData ?? true;
  const personalDataReached = reportsPersonalData
    ? profile.personalData.filter((p) => reached.has(p.assetId))
    : [];
  const reasons = reportReasons(personalDataReached, deadlines);

  const moneyReached =
    reachedPaths.length > 0 &&
    (damageTypeDefs.find((d) => d.id === damageType)?.reachesMoney === true ||
      reachedPaths.some((p) =>
        p.steps.some((s) => s.role === "impact.money" && s.state !== "blocked"),
      ));
  const moneyLossJpy =
    moneyReached && profile.typicalTransferJpy !== undefined
      ? profile.typicalTransferJpy
      : undefined;

  return {
    stopped,
    downtimeDays,
    ...(partnerImpactDay !== undefined ? { partnerImpactDay } : {}),
    ...(profile.dailyRevenue !== undefined && downtimeDays > 0
      ? { revenueImpactJpy: profile.dailyRevenue * downtimeDays }
      : {}),
    ...(moneyLossJpy !== undefined ? { moneyLossJpy } : {}),
    personalDataReached,
    reportRequired: reasons.length > 0,
    ...(reasons.length > 0 ? { reportReasonsJa: reasons } : {}),
  };
}

/**
 * 金額の表示（円）：1 億円以上は億、1 万円以上は万で小数 1 桁に丸める（約 1 億円、約 2,000 万円、約 158.4 万円）。
 * 万で丸めて 1 億円に届けば億で表示する。社長向けの文に使う
 */
export function formatJpy(n: number): string {
  const round1 = (v: number) => Math.round(v * 10) / 10;
  const fmt = (v: number) =>
    v.toLocaleString("ja-JP", { minimumFractionDigits: 0, maximumFractionDigits: 1 });
  if (n < 10_000) return `${Math.round(n).toLocaleString("ja-JP")} 円`;
  const man = round1(n / 10_000);
  if (n >= 100_000_000 || man >= 10_000) return `約 ${fmt(round1(n / 100_000_000))} 億円`;
  return `約 ${fmt(man)} 万円`;
}
