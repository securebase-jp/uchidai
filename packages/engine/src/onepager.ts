/**
 * 社長向けの一枚：Verdict と会社カルテ、知識ファイルから、専門用語と ID を使わない一枚のデータを作る
 *
 * 文はテンプレートで組む（Claude の言い換えはまだ使わない）。数字はすべてプログラムの計算結果。
 * 画面（S3）はこのデータをそのまま描画する。
 */
import { z } from "zod";
import { NEEDS_PREVIOUS_LINE } from "./evaluate.ts";
import { formatJpy } from "./impact.ts";
import type { Knowledge, MeasureDef } from "./knowledge.ts";
import { resolveControl } from "./rules.ts";
import { type CompanyProfile, type PathStep, type Verdict, VerdictResult } from "./types.ts";

const ID_PATTERN = String.raw`(?:TA\d{4}|T\d{4}(?:\.\d{3})?|M\d{4}|UD-\d{2})`;
const PAREN_IDS = new RegExp(
  String.raw`\s*[（(]\s*${ID_PATTERN}(?:\s*[、,／/]\s*${ID_PATTERN})*\s*[）)]`,
  "g",
);
const BARE_ID = new RegExp(String.raw`\s*(?<![A-Za-z0-9-])${ID_PATTERN}(?![A-Za-z0-9-])`, "g");

/** 判定ルールや知識ファイルの文に混じる手法 ID・緩和策 ID を取り除く（社長向けの一枚には ID を出さない） */
export function stripIds(text: string): string {
  return text
    .replace(PAREN_IDS, "")
    .replace(BARE_ID, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export const OnePagerStopped = z.object({
  name: z.string(),
  days: z.number(),
  manualDays: z.number(),
  partnerDay: z.number().optional(),
  affectsJa: z.string().optional(),
});
export const OnePagerDeadline = z.object({
  day: z.number(),
  kind: z.enum(["legal", "insurance", "partner", "police", "money"]),
  labelJa: z.string(),
  sourceJa: z.string().optional(),
  /** knowledge/deadlines.yaml の期限 ID（出典の絞り込みに使う） */
  deadlineId: z.string().optional(),
});
export const OnePagerMeasure = z.object({
  id: z.string(),
  labelJa: z.string(),
  /** この対策が効く段階（型紙の見出し） */
  stageJa: z.string().optional(),
  requestToJa: z.string().optional(),
  basis: z.enum(["ipa", "quote", "internal"]),
  costJa: z.string(),
  costJpy: z.number().optional(),
  costSourceJa: z.string().optional(),
});
export const OnePager = z.object({
  companyName: z.string(),
  fictional: z.boolean(),
  caseTitle: z.string(),
  result: VerdictResult,
  headlineJa: z.string(),
  /** 何が起きるか（専門用語・ID なしの文） */
  whatHappensJa: z.array(z.string()),
  stopped: z.array(OnePagerStopped),
  downtimeDays: z.number(),
  partnerImpactDay: z.number().optional(),
  partnerImpactJa: z.string().optional(),
  revenueImpactJpy: z.number().optional(),
  revenueImpactJa: z.string().optional(),
  moneyLossJpy: z.number().optional(),
  moneyLossJa: z.string().optional(),
  deadlines: z.array(OnePagerDeadline),
  measures: z.array(OnePagerMeasure),
  sources: z.array(z.string()),
  notesJa: z.array(z.string()),
});
export type OnePagerStopped = z.infer<typeof OnePagerStopped>;
export type OnePagerDeadline = z.infer<typeof OnePagerDeadline>;
export type OnePagerMeasure = z.infer<typeof OnePagerMeasure>;
export type OnePager = z.infer<typeof OnePager>;

export type OnePagerOptions = { caseTitle?: string };

const ROLE_FALLBACK_LABEL: Record<string, string> = {
  "impact.money": "会社の口座",
  "impact.partner": "取引先",
  "impact.legal": "個人情報保護委員会",
  "impact.revenue": "売上",
};

function nodeLabel(nodeId: string, role: string, profile: CompanyProfile, knowledge: Knowledge) {
  const asset = profile.assets.find((a) => a.id === nodeId);
  if (asset) return asset.label;
  return ROLE_FALLBACK_LABEL[role] ?? knowledge.roles.find((r) => r.id === role)?.labelJa ?? "社内";
}

/** 経路の段階を、専門用語を使わずに一本の文にする */
function describePath(verdict: Verdict, profile: CompanyProfile, knowledge: Knowledge): string[] {
  const path =
    verdict.paths.find((p) => p.reachedCore && p.source !== "ai") ??
    verdict.paths.find((p) => p.source !== "ai") ??
    verdict.paths[0];
  if (!path) return [];
  // 型紙に「突破されたときの言葉」があれば「バックアップが暗号化される」のように資産名＋その言葉で、
  // 無ければ段階の見出し＋資産名で書く（画面の構成図の札と同じ言葉になる）
  // 記事が「痕跡なし」「攻撃者の主張」とする段階は、起きた出来事として進む順に並べない（下で別に書く）
  const happened = (s: PathStep) => s.certainty !== "no_trace" && s.certainty !== "claimed";
  const chain = path.steps
    .filter((s) => !s.precondition && happened(s))
    .map((s) => {
      const node = nodeLabel(s.nodeId, s.role, profile, knowledge);
      // 型紙に完全な文があれば、それを使う（「会社の口座が起きる」「業務サーバ区画が持ち出される」を避ける）
      if (s.sentenceJa && s.state !== "blocked") return s.sentenceJa.replaceAll("{node}", node);
      return s.breachedLabelJa && s.state !== "blocked"
        ? `${node}が${s.breachedLabelJa}`
        : `${s.labelJa ?? "次の段階へ進む"}（${node}）`;
    })
    .join(" → ");
  const lines: string[] = [];
  // 記事の会社が被害を防げた事例（未遂・回避）：被害が出た記事と取り違えないよう、最初に書く
  if (verdict.article?.averted)
    lines.push(
      "記事の会社は、被害を防げた事例です。以下は、同じ手口が御社に来たら、という見立てです。",
    );
  // 第三者（委託先・取引先・提供元）で起きた事故：御社の設備が入口になったとは書かず、「御社が同じ立場なら」の見立てにする
  const third = verdict.thirdParty;
  if (third)
    lines.push(
      `これは${third.labelJa}で起きた事故です。${third.leadNoteJa ?? "御社の設備が入口になったのではありません。"}`,
    );
  // 入口が記事から分からず仮に置いた候補のときは、その入口から入られたと断定しない
  const first = path.steps.find((s) => !s.precondition);
  const entryNode = first ? nodeLabel(first.nodeId, first.role, profile, knowledge) : "";
  const lead =
    first?.source === "candidate"
      ? `入口はまだ分かっていません。たとえば「${entryNode}」から入られた${third ? "として、" : "場合、"}`
      : "";
  if (path.reachedCore) {
    lines.push(
      `${lead}${third ? "御社が同じ立場なら、攻撃は次の順に進むと見込まれます：" : "攻撃は次の順に進みます："}${chain}。`,
    );
  } else {
    const stop = path.steps.find((s) => s.state === "blocked");
    const where = stop
      ? `「${stop.labelJa ?? "途中"}」の段階（${nodeLabel(stop.nodeId, stop.role, profile, knowledge)}）`
      : "途中";
    const reason = stop?.reasonJa ? stripIds(stop.reasonJa) : "";
    lines.push(
      `${third ? "御社が同じ立場なら、" : ""}この攻撃は${where}で止まります。${reason ? `理由：${reason}。` : ""}`,
    );
    if (verdict.result === "pending")
      lines.push(
        "ただし、確認が取れていない項目が残っています。回答が届き次第、判定を更新します。",
      );
  }
  // 記事の書き方が「確認された出来事」でない段階は、その書き方のまま別の文にする
  for (const s of path.steps.filter((x) => !x.precondition && x.certainty)) {
    const what = `「${s.labelJa ?? "次の段階"}」（${nodeLabel(s.nodeId, s.role, profile, knowledge)}）`;
    if (s.certainty === "possible")
      lines.push(`記事では、${what}の可能性があるとされています（確認された事実ではありません）。`);
    else if (s.certainty === "exposed_only")
      lines.push(`${what}は閲覧できる状態でしたが、実際に取得されたかは確認されていません。`);
    else if (s.certainty === "no_trace") lines.push(`${what}について、痕跡は確認されていません。`);
    else if (s.certainty === "claimed")
      lines.push(`${what}は攻撃者の主張で、事実かどうかは確認されていません。`);
  }
  for (const s of path.steps.filter((x) => !x.precondition && x.published)) {
    const what = `「${s.labelJa ?? "次の段階"}」（${nodeLabel(s.nodeId, s.role, profile, knowledge)}）`;
    lines.push(`${what}で持ち出された情報は、すでに公開されたと記事に書かれています。`);
  }
  if (verdict.result === "pending") {
    const unknown = path.steps.filter((s) => s.state === "unknown");
    if (unknown.length > 0)
      lines.push(
        `確認中：${unknown.map((s) => `${s.labelJa ?? s.role}（${nodeLabel(s.nodeId, s.role, profile, knowledge)}）`).join("、")}。`,
      );
  }
  return lines;
}

/** 経路が無いときの「何が起きるか」の代わりの文 */
function emptyPathLines(verdict: Verdict): string[] {
  if (verdict.guidanceJa) return verdict.guidanceJa;
  if (verdict.coverageGapJa) return [verdict.coverageGapJa];
  if (verdict.result === "no_entry")
    return ["この攻撃が入る入口は、登録されたカルテにありません。"];
  if (verdict.result === "out_of_scope")
    return [
      verdict.needsPrevious
        ? NEEDS_PREVIOUS_LINE
        : "この事故は攻撃経路で判定できないため、被害の見込みは出していません。",
    ];
  return [];
}

/** 第三者の事故のとき、御社が確認すること（判定は出さない。個人情報の報告は「確認が必要」と書く） */
export function thirdPartyLines(verdict: Verdict): string[] {
  const t = verdict.thirdParty;
  if (!t) return [];
  return [
    ...t.checksJa.map((c) => `御社が確認すること：${c}。`),
    ...(t.reportNoteJa ? [t.reportNoteJa] : []),
  ];
}

/**
 * 報告義務の安心側に倒さないための注意（B-004）：メールアカウントに入られる経路では、メールの中身を見られた可能性がある。
 * カルテに個人情報として登録されていなくても、「報告は不要」とは書かず、内容の確認を求める
 */
export function reportCautionLines(verdict: Verdict): string[] {
  const mailboxReached = verdict.paths.some(
    (p) =>
      p.reachedCore &&
      p.steps.some((s) => s.role.startsWith("cloud.mail_account") && s.state !== "blocked"),
  );
  if (!mailboxReached || verdict.impact.reportRequired) return [];
  return [
    "メールの中身を見られた可能性があり、個人情報が含まれていれば、個人情報保護委員会への報告の対象です。メールの内容の確認が必要です。",
  ];
}

/**
 * 記事が書く漏えいした情報の種類ごとの案内（D-011）。件数・種類は会社カルテの計算とは別で、
 * 「御社が同じ種類の情報を預かっているなら」（第三者の事故のときは「預けている情報に含まれるなら」）と、御社の話として書く
 */
export function leakedDataLines(verdict: Verdict): string[] {
  const third = verdict.thirdParty;
  return (verdict.leakedData ?? []).map(
    (k) =>
      `記事で漏えいしたとされる情報に「${k.labelJa}」が含まれます。${third ? `${third.labelJa}に預けている情報に、同じ種類が含まれる場合：` : "御社が同じ種類の情報を預かっている場合："}${k.noteJa}`,
  );
}

/** 言い換えの文のあとに、プログラムの文として付ける行（第三者の事故の確認事項、報告義務の注意） */
export function onePagerExtraLines(verdict: Verdict): string[] {
  return [...thirdPartyLines(verdict), ...leakedDataLines(verdict), ...reportCautionLines(verdict)];
}

/** 対策の patches がカルテで既に満たされているか（緩和策あり、属性も一致）。満たしていれば勧めない */
function alreadyApplied(m: MeasureDef, profile: CompanyProfile): boolean {
  // 助言だけの対策（patches が空）は、カルテに書き込めないので「済み」とは見なさない
  if (m.patches.length === 0) return false;
  return m.patches.every((p) => {
    const targets = profile.assets.filter((a) => a.role === p.role);
    return (
      targets.length > 0 &&
      targets.every(
        (a) =>
          resolveControl(a, p.mitigation)?.status === p.status &&
          Object.entries(p.attrs ?? {}).every(([k, v]) => a.attrs[k] === v),
      )
    );
  });
}

/**
 * 経路のどこかで効く対策（効かない対策、経路の外の対策、AI が見つけた経路だけに効く対策は載せない）。
 * 並び順は、攻撃を早い段階で止める対策が先（経路の何段目で効くか）。同じ段なら measures.yaml の順。
 * profile を渡すと、既に講じてある対策（切り離したバックアップ済みなど）は除く
 */
export function effectiveMeasures(
  verdict: Verdict,
  measures: MeasureDef[],
  profile?: CompanyProfile,
): { measure: MeasureDef; stageJa?: string }[] {
  const steps = verdict.paths
    .filter((p) => p.source !== "ai")
    .flatMap((p) => p.steps.filter((s) => !s.precondition).map((s, index) => ({ s, index })))
    .filter(({ s }) => s.state !== "blocked");
  const out: { measure: MeasureDef; stageJa?: string; index: number; order: number }[] = [];
  measures.forEach((m, order) => {
    if (profile && alreadyApplied(m, profile)) return;
    const mitigations = new Set([m.mitigation, ...m.patches.map((p) => p.mitigation)]);
    const roles = new Set(m.patches.map((p) => p.role));
    const hits = steps.filter(
      ({ s }) =>
        roles.has(s.role) &&
        s.mitigations.some((x) => mitigations.has(x)) &&
        !s.ineffective.some((i) => mitigations.has(i.mitigation)),
    );
    const first = hits.reduce<(typeof hits)[number] | undefined>(
      (best, h) => (best === undefined || h.index < best.index ? h : best),
      undefined,
    );
    if (first)
      out.push({
        measure: m,
        ...(first.s.labelJa ? { stageJa: first.s.labelJa } : {}),
        index: first.index,
        order,
      });
  });
  const effective = out
    .sort((a, b) => a.index - b.index || a.order - b.order)
    .map(({ measure, stageJa }) => ({ measure, ...(stageJa ? { stageJa } : {}) }));
  // 第三者の事故のときは、判定に使わない助言（委託先管理など。victims.yaml の measureIds）を、効く対策のあとに足す
  const advice = (verdict.thirdParty?.measureIds ?? [])
    .map((id) => measures.find((m) => m.id === id))
    .filter(
      (m): m is MeasureDef => m !== undefined && !effective.some((e) => e.measure.id === m.id),
    )
    .map((measure) => ({ measure }));
  return [...effective, ...advice];
}

/** 対策の費用の目安（knowledge/costs.yaml と カルテの人数から）。画面の対策ボタンでも使う */
export function measureCost(
  m: MeasureDef,
  profile: CompanyProfile,
  knowledge: Knowledge,
): Pick<OnePagerMeasure, "basis" | "costJa" | "costJpy" | "costSourceJa"> {
  const entry = knowledge.costs.measures.find((c) => c.measureId === m.id);
  if (!entry || entry.basis === "quote") {
    return {
      basis: "quote",
      costJa: "ベンダーの見積もり待ち",
      ...(entry?.noteJa ? { costSourceJa: entry.noteJa } : {}),
    };
  }
  if (entry.basis === "internal") {
    return {
      basis: "internal",
      costJa: "社内ルール（外部費用なし）",
      ...(entry.noteJa ? { costSourceJa: entry.noteJa } : {}),
    };
  }
  const unit = knowledge.costs.unitPrices.find((u) => u.id === entry.unitPriceId);
  if (!unit) return { basis: "quote", costJa: "ベンダーの見積もり待ち" };
  const qty =
    entry.quantity === "devices" || entry.quantity === "people"
      ? profile.employees
      : entry.quantity === "company"
        ? 1
        : undefined;
  const source = `${knowledge.costs.sourceJa} ${unit.pageJa}`;
  if (qty === undefined) {
    return {
      basis: "ipa",
      costJa: `${unit.unitJpy.toLocaleString("ja-JP")} 円 ／ ${PER_JA[unit.per]}（台数未登録のため合計は未算出）`,
      costSourceJa: source,
    };
  }
  const total = unit.unitJpy * qty;
  const period = unit.per === "device_year" ? "／年" : "";
  return {
    basis: "ipa",
    costJa: `${formatJpy(total)}${period}（${unit.unitJpy.toLocaleString("ja-JP")} 円 × ${qty} ${UNIT_JA[unit.per]}${entry.noteJa ? `。${entry.noteJa}` : ""}）`,
    costJpy: total,
    costSourceJa: source,
  };
}
const PER_JA = { device_year: "台・年", person: "人", company: "社", service: "サービス" } as const;
const UNIT_JA = { device_year: "台", person: "人", company: "社", service: "件" } as const;

export function buildOnePager(
  verdict: Verdict,
  profile: CompanyProfile,
  knowledge: Knowledge,
  options: OnePagerOptions = {},
): OnePager {
  const { impact } = verdict;
  const stopped: OnePagerStopped[] = impact.stopped.map((s) => ({
    name: s.name,
    days: s.days,
    manualDays: s.manualDays,
    ...(s.partnerDay !== undefined ? { partnerDay: s.partnerDay } : {}),
    ...(s.affectsJa ? { affectsJa: s.affectsJa } : {}),
  }));
  const whatHappens = describePath(verdict, profile, knowledge);
  // 経路が無いとき（入口なし・対象外・カルテの範囲で入口が見つからない）に「何が起きるか」を空にしない
  if (whatHappens.length === 0) whatHappens.push(...emptyPathLines(verdict));
  if (stopped.length > 0) {
    const names = stopped.map((s) => `「${s.name}」`).join("、");
    whatHappens.push(
      `${names}が止まり、復旧まで最長 ${impact.downtimeDays} 日かかる見込みです（会社カルテに登録した復旧日数の目安）。`,
    );
  }
  const partnerBiz = stopped.find((s) => s.partnerDay === impact.partnerImpactDay);
  const partnerImpactJa =
    impact.partnerImpactDay !== undefined
      ? `${impact.partnerImpactDay} 日目から${partnerBiz?.affectsJa ?? "取引先"}に影響が出ます（手作業で回せるのは ${partnerBiz?.manualDays ?? 0} 日まで）。`
      : stopped.length > 0
        ? "復旧が手作業で回せる期間に収まるため、取引先への影響は見込みません。"
        : undefined;
  if (partnerImpactJa) whatHappens.push(partnerImpactJa);
  const reported = verdict.article?.reportedLossJpy;
  // 記事の被害額は記事の事実として別の文にし、御社の額は必ず「想定では」を付けて並べる（計算には記事の額を使わない）
  if (reported !== undefined)
    whatHappens.push(`記事の事例では、被害額は${formatJpy(reported)}です。`);
  if (impact.moneyLossJpy !== undefined)
    whatHappens.push(
      reported !== undefined
        ? `御社の想定では、なりすましの指示で送金すると、${formatJpy(impact.moneyLossJpy)}の資金が流出すると見込まれます（会社カルテの想定額）。`
        : `なりすましの指示で送金すると、${formatJpy(impact.moneyLossJpy)}の資金が流出します（会社カルテの想定額）。`,
    );
  if (impact.reportRequired)
    whatHappens.push(
      `${impact.personalDataReached.map((p) => p.descriptionJa).join("、")}が漏えいしたおそれがあり、個人情報保護委員会への報告と本人への通知が必要になります。`,
    );
  whatHappens.push(...onePagerExtraLines(verdict));

  const deadlines: OnePagerDeadline[] = verdict.timeline
    .filter(
      (e): e is typeof e & { kind: OnePagerDeadline["kind"] } =>
        e.deadlineId !== undefined && e.kind !== "business_stop" && e.kind !== "recovery",
    )
    .map((e) => ({
      day: e.day,
      kind: e.kind,
      labelJa: stripIds(e.labelJa),
      ...(e.sourceJa ? { sourceJa: e.sourceJa } : {}),
      ...(e.deadlineId ? { deadlineId: e.deadlineId } : {}),
    }));

  const measures: OnePagerMeasure[] = effectiveMeasures(verdict, knowledge.measures, profile).map(
    ({ measure: m, stageJa }) => ({
      id: m.id,
      labelJa: stripIds(m.labelJa),
      ...(stageJa ? { stageJa: stripIds(stageJa) } : {}),
      ...(m.requestToJa ? { requestToJa: m.requestToJa } : {}),
      ...measureCost(m, profile, knowledge),
    }),
  );

  // 出典は、この一枚で実際に使った期限の出典だけを載せる（事例の種類に関係ない出典は載せない）
  const usedSourceIds = new Set(
    deadlines
      .map((d) => knowledge.deadlines.deadlines.find((x) => x.id === d.deadlineId)?.sourceId)
      .filter((id): id is string => id !== undefined),
  );
  // 記事が書く漏えいした情報の種類の案内を出したときは、その根拠（leak-kinds.yaml の sourceIds）も載せる
  for (const l of verdict.leakedData ?? [])
    for (const id of knowledge.leakKinds.find((x) => x.id === l.id)?.sourceIds ?? [])
      usedSourceIds.add(id);
  const sources = [
    `${knowledge.costs.sourceJa}（${knowledge.costs.sourceUrl}）`,
    `MITRE ATT&CK Enterprise v${verdict.attackVersion}（攻撃の段階の対応づけ。対象は Enterprise のみで、工場の制御システム（ICS）への攻撃は対象外）`,
    ...knowledge.deadlines.sources
      .filter((s) => s.url && usedSourceIds.has(s.id))
      .map((s) => `${s.nameJa}（${s.url}、${s.checkedAt} 確認）`),
    // 第三者の事故のとき、御社が確認することと委託先管理の助言の根拠
    ...(verdict.thirdParty
      ? [
          "個人情報保護委員会「個人情報の保護に関する法律についてのガイドライン（通則編）」3-4-4 委託先の監督（法第25条）（https://www.ppc.go.jp/personalinfo/legal/guidelines_tsusoku/、2026-11-05 確認）",
        ]
      : []),
  ];
  const notes = [
    ...(profile.fictional ? ["この会社は架空の会社です。数値はデモ用の仮の値です。"] : []),
    "停止日数・売上影響・期限は、会社カルテと公開資料の固定データからプログラムが計算しています。AI は計算していません。",
    "売上影響の目安は「1 日あたりの売上 × 停止日数」で、外部統計からの損害額の推計ではありません。",
    "費用の目安は出典で確認できた単価だけを載せ、確認できない対策は「ベンダーの見積もり待ち」としています。",
  ];

  return OnePager.parse({
    companyName: profile.companyName,
    fictional: profile.fictional,
    caseTitle: options.caseTitle ?? "",
    result: verdict.result,
    headlineJa: verdict.headlineJa,
    whatHappensJa: whatHappens.map(stripIds),
    stopped,
    downtimeDays: impact.downtimeDays,
    ...(impact.partnerImpactDay !== undefined ? { partnerImpactDay: impact.partnerImpactDay } : {}),
    ...(partnerImpactJa ? { partnerImpactJa } : {}),
    ...(impact.revenueImpactJpy !== undefined
      ? {
          revenueImpactJpy: impact.revenueImpactJpy,
          revenueImpactJa: `売上影響の目安 ${formatJpy(impact.revenueImpactJpy)}（1 日の売上 ${formatJpy(profile.dailyRevenue ?? 0)} × ${impact.downtimeDays} 日）`,
        }
      : {}),
    ...(impact.moneyLossJpy !== undefined
      ? {
          moneyLossJpy: impact.moneyLossJpy,
          moneyLossJa: `送金額の目安 ${formatJpy(impact.moneyLossJpy)}`,
        }
      : {}),
    deadlines,
    measures,
    sources,
    notesJa: notes,
  });
}
