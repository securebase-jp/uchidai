/**
 * 経営への影響：到達した資産 → 止まる業務 → 停止日数・取引先への影響が出る日・売上影響・送金額・個人情報の報告義務
 *
 * 数字はすべて会社カルテと固定データ（knowledge/deadlines.yaml）から決定的に計算する。
 * 外部統計からの損害額の推計はしない（売上影響は「1 日あたりの売上 × 停止日数」の目安だけ）。
 */
import { type DeadlinesFile, type Knowledge, loadDeadlines } from "./knowledge.ts";
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

/** 到達した経路に「復旧できる」段階（切り離したバックアップなど）があるか */
export function hasRecoverableStep(paths: AttackPath[]): boolean {
  return paths.some((p) => p.reachedCore && p.steps.some((s) => s.state === "recoverable"));
}

/** 経路の型紙 ID から事例の種類を引く（型紙 ID は damageType と同名） */
export function damageTypeOf(
  input: Pick<Verdict, "paths"> | AttackPath[],
  knowledge?: Knowledge,
): DamageType | undefined {
  const first = pathsOf(input).find((p) => p.templateId)?.templateId;
  if (!first) return undefined;
  const t = knowledge?.templates.find((x) => x.id === first);
  if (t) return t.damageType;
  const parsed = DamageTypeValues.find((d) => d === first);
  return parsed;
}
const DamageTypeValues: DamageType[] = ["ransomware", "bec", "data_breach", "out_of_scope"];

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
  return deadlines.reportTriggers.filter((t) => matches(t.when)).map((t) => t.labelJa);
}

/**
 * 経路（または Verdict）と会社カルテから経営への影響を計算する。
 * - 業務は、依存する資産のどれかに経路が到達したら止まる（recoveryDays が 0 の業務は止まらない）
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

  const stopped = profile.businesses
    .filter((b) => b.recoveryDays > 0 && b.assetIds.some((id) => reached.has(id)))
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

  const personalDataReached = profile.personalData.filter((p) => reached.has(p.assetId));
  const reasons = reportReasons(personalDataReached, deadlines);

  const moneyReached =
    reachedPaths.length > 0 &&
    (damageType === "bec" ||
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

/** 金額の表示（円）：1 億円以上は億、1 万円以上は万で丸める。社長向けの文に使う */
export function formatJpy(n: number): string {
  const fmt = (v: number) => {
    const r = Math.round(v * 10) / 10;
    return Number.isInteger(r) ? String(r) : r.toFixed(1);
  };
  if (n >= 100_000_000) return `約 ${fmt(n / 100_000_000)} 億円`;
  if (n >= 10_000) return `約 ${fmt(n / 10_000).replace(/\.0$/, "")} 万円`;
  return `${n.toLocaleString("ja-JP")} 円`;
}
