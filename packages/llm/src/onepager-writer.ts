/**
 * 社長向けの一枚の「何が起きるか」を Claude に言い換えさせる。
 *
 * Claude に渡すのは役割名と数値だけ（製品名・バージョン・社名・ID は渡さない）。
 * 出力は zod で検証し、ID や入力にない数値が混じっていれば捨てて、engine のテンプレート文に戻す。
 * 判定と計算はしない。文章の言い換えだけ。
 */
import type Anthropic from "@anthropic-ai/sdk";
import {
  type Knowledge,
  type OnePager,
  StepCertainty,
  StepState,
  type Verdict,
  VerdictResult,
} from "@uchidai/engine";
import { z } from "zod";
import { callStructured, type LlmOptions, type StructuredResult } from "./client.ts";

/**
 * 段階が起きたことの確認状況（PathStep.source から）。対策の確認状況（state）とは別のもの。
 * stated = 記事に書かれている／inferred = 記事に無いが通常起きる段階（推定）／candidate = 入口が分からないため仮に置いた候補
 */
export const WriterStageSource = z.enum(["stated", "inferred", "candidate"]);
export type WriterStageSource = z.infer<typeof WriterStageSource>;

export const WriterStage = z.object({
  /** 型紙の段階の見出し（例：入口から侵入） */
  labelJa: z.string(),
  /** 役割の枠の日本語（例：VPN装置、管理者アカウント）。会社固有の製品名は含めない */
  roleJa: z.string(),
  /** 対策の確認状況。unknown = その段階を止める対策が未確認（攻撃が起きたかどうかではない） */
  state: StepState,
  /** 出来事の確認状況。記載の段階を「確認が取れていない」と書かせないために渡す */
  source: WriterStageSource,
  /** 記事が出来事をどう書いているか（可能性・痕跡なし・主張など）。省略は confirmed と同じ */
  certainty: StepCertainty.optional(),
  /** 持ち出された情報がすでに公開されたと記事が書いている */
  published: z.boolean().optional(),
});
export const OnePagerWriterInput = z.object({
  result: VerdictResult,
  stages: z.array(WriterStage),
  stopped: z.array(
    z.object({
      name: z.string(),
      days: z.number(),
      manualDays: z.number(),
      affectsJa: z.string().optional(),
    }),
  ),
  downtimeDays: z.number(),
  partnerImpactDay: z.number().optional(),
  revenueImpactJpy: z.number().optional(),
  moneyLossJpy: z.number().optional(),
  reportRequired: z.boolean(),
  /** 到達した個人情報の説明（例：取引先担当者の連絡先） */
  personalDataJa: z.array(z.string()),
  /** 被害が第三者（委託先・取引先・提供元）に起きた事故のとき。その呼び名（例：委託先・取引先） */
  thirdPartyJa: z.string().optional(),
});
export const OnePagerWriterOutput = z.object({
  whatHappensJa: z.array(z.string().min(1).max(200)).min(1).max(8),
});
export type WriterStage = z.infer<typeof WriterStage>;
export type OnePagerWriterInput = z.infer<typeof OnePagerWriterInput>;
export type OnePagerWriterOutput = z.infer<typeof OnePagerWriterOutput>;

export const onePagerWriterJsonSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    whatHappensJa: {
      type: "array",
      description: "社長向けの短い文。2〜6 文。各要素が一文",
      items: { type: "string" },
    },
  },
  required: ["whatHappensJa"],
  additionalProperties: false,
};

/** Verdict から Claude に渡す入力を作る（役割名と数値だけ） */
export function writerInputFrom(
  verdict: Verdict,
  knowledge: Pick<Knowledge, "roles">,
): OnePagerWriterInput {
  const path =
    verdict.paths.find((p) => p.reachedCore && p.source !== "ai") ??
    verdict.paths.find((p) => p.source !== "ai") ??
    verdict.paths[0];
  const roleJa = (role: string) => knowledge.roles.find((r) => r.id === role)?.labelJa ?? role;
  const stages: WriterStage[] = (path?.steps ?? [])
    .filter((s) => !s.precondition)
    .map((s) => ({
      // 段階名の「・業務停止」は御社の試算（stopped）の話で、記事の事実ではない。言い換えが事実の文に混ぜないように外す
      labelJa: (s.labelJa ?? s.role).replace(/[・、]?業務停止/g, ""),
      roleJa: roleJa(s.role),
      state: s.state,
      // AI が見つけた経路の段階は、記事の確認を伴わないので推定として扱う
      source: s.source === "ai" ? "inferred" : s.source,
      ...(s.certainty && s.certainty !== "confirmed" ? { certainty: s.certainty } : {}),
      ...(s.published ? { published: true } : {}),
    }));
  const { impact } = verdict;
  return OnePagerWriterInput.parse({
    result: verdict.result,
    stages,
    stopped: impact.stopped.map((s) => ({
      name: s.name,
      days: s.days,
      manualDays: s.manualDays,
      ...(s.affectsJa ? { affectsJa: s.affectsJa } : {}),
    })),
    downtimeDays: impact.downtimeDays,
    ...(impact.partnerImpactDay !== undefined ? { partnerImpactDay: impact.partnerImpactDay } : {}),
    ...(impact.revenueImpactJpy !== undefined ? { revenueImpactJpy: impact.revenueImpactJpy } : {}),
    ...(impact.moneyLossJpy !== undefined ? { moneyLossJpy: impact.moneyLossJpy } : {}),
    reportRequired: impact.reportRequired,
    personalDataJa: impact.personalDataReached.map((p) => p.descriptionJa),
    ...(verdict.thirdParty ? { thirdPartyJa: verdict.thirdParty.labelJa } : {}),
  });
}

export const WRITER_RULES_JA = `あなたは、中小企業の社長に向けて説明文を書く書き手です。与えられた判定結果（役割名と数値だけ）を、社長がそのまま読める短い日本語の文にします。

## 絶対に守ること
- 数値（日数、金額、人数）は入力にあるものだけを、そのままの値で使う。新しい数値、期限、確率、割合を作らない
- 金額は「300万円」「1,500万円」のように万円の単位で書く（「3000000円」とは書かない）。1 万円に満たない端数があるときだけ円で書く
- 専門用語、英字の略語、ID（例：T1190、M1032）は使わない。入力にある役割名と業務名はそのまま使ってよい
- 攻撃の段階は入力の順番どおりに「どこから入り、どこへ進み、何が止まるか」として書く。state が blocked の段階があれば、そこで止まることを書く。human は「人の判断にかかっている」と書く
- 各段階には二つの別の情報がある。混ぜないこと
  - source（出来事の確認状況）：stated は記事に書かれた出来事なので「確認されています」「起きています」と書き、「確認が取れていません」「不明」とは決して書かない。inferred は記事に無い推定なので「〜と考えられます」「〜おそれがあります」と書き、断定しない。candidate は入口が記事から分からないため仮に置いた候補で、最初の段階が candidate なら「入口はまだ分かっていません。たとえば〇〇から入られた場合は」と書き、その入口から入られたと断定しない
  - certainty（記事がその出来事をどう書いているか。無いときは confirmed）：記事の書き方に合わせた言い方にする。「確認されています」を使えるのは source が stated で certainty が無い段階だけ
    - possible：「記事では〜の可能性があるとされています」。起きたと断定しない
    - exposed_only：「〜は閲覧できる状態でした。実際に取得されたかは確認されていません」と書く（この言い回しに固定）
    - no_trace：「〜の痕跡は確認されていません」と書く（この言い回しに固定）。起きたと書かない
    - claimed：「攻撃者は〜と主張しています」と書く。事実とは書かない
  - published（持ち出された情報が、すでに公開されたと記事が書いている）：「持ち出された情報は、すでに公開されています」と書く
- 被害が第三者の事故のとき（thirdPartyJa がある）：段階は、記事の第三者（thirdPartyJa）で起きたこととして書く。確認の言い方を使う最初の文の主語は「記事の〇〇では」とし、続く文はその主語のまま書き（「続けて」「さらに」でつなぐ）、御社の設備（VPN装置など）から侵入されたと書かない。最初の文で「これは〇〇で起きた事故です」と書き、御社の試算は「御社が同じ立場なら、〜と見込まれます」と書く。御社が確認することと個人情報の報告の案内は、別にプログラムが付けるので書かない
- 文の分け方：前半は記事に書かれた出来事だけを書く（確度に合う言い方で）。止まる業務・日数・売上・取引先への影響は、御社に当てはめた試算なので、別の文にして「御社の場合は〜と見込まれます」と書く。試算の文に「確認されています」「起きています」を使わない（試算は記事の事実ではない）。記事の事実の文に、業務が止まったことを書かない（業務が止まることは、御社の試算の文にだけ書く。記事の会社の業務が止まったかどうかは入力にない）。一つの文に、確認の言い方と日数・金額を混ぜない。例：「中核システムが暗号化されたことが確認されています。」（記事の事実）と「御社の場合は、受注・生産管理が10日止まると見込まれます。」（試算）は別の文にする。段階が多いときは、近い段階を 1 文にまとめ、全体で 6 文以内にする
  - state（その段階を止める対策の確認状況）：unknown のときだけ「この段階を止める対策が確認できていません」と書く（この言い回しに固定）。どの段階の話か分かるよう、その段階の説明と同じ文に続けて書き（例：「管理者権限を奪われるおそれがあり、この段階を止める対策が確認できていません」）、この言い回しだけの短い文にしない。攻撃が起きたかどうかの話には使わない
- result が breached なら、止まる業務と復旧までの日数、取引先への影響が出る日、売上への影響、個人情報の報告が必要になるかを、入力にある分だけ書く。無いものは書かない
- stopped が空（止まる業務が無い）ときは、止まる業務のことも復旧までの日数も書かない。downtimeDays が 0 でも「0日」「0 日」とは書かない。止まらなかったことと、個人情報の報告など入力にあることだけを書く
- 一文は 70 字以内。2〜6 文（多くても 8 文まで）。敬体（です・ます）。煽らず、断定は入力の範囲内で
- 出力は JSON スキーマどおり。文章はすべて日本語`;

/** state が unknown の段階の言い回し（固定）。攻撃が起きたかどうかではなく、止める対策の確認の話 */
export const UNKNOWN_CONTROL_PHRASE = "この段階を止める対策が確認できていません";
/** 入口が候補のときの言い回し（固定の前半） */
export const CANDIDATE_ENTRY_PHRASE = "入口はまだ分かっていません";
const UNKNOWN_CONTROL_SHORT = "止める対策が確認できていません";
/** 確度ごとの固定の言い回し。これらの中の「確認されていません」は否定の誤用に数えない */
export const NO_TRACE_PHRASE = "痕跡は確認されていません";
export const EXPOSED_ONLY_PHRASE = "取得されたかは確認されていません";
const CLAIMED_PHRASE_RE = /事実かどうかは確認されていません/;
/** 試算の文に入ってはいけない「確認」の言い方、試算の語 */
const CONFIRM_RE = /確認(され|が取れ)て(い)?(ま(す|した)|る)|確認されました/;
const ESTIMATE_RE = /\d\s*日|\d[\d,.]*\s*(万|億)?円|止まり|止まる|止まっ|停止/;
const ESTIMATE_PHRASE = "御社の場合は";
/** 出来事を否定する言い方（「確認が取れていません」など）。固定の言い回しは除いて調べる */
const DENIAL =
  /確認が取れて(?:い|お)(?:ない|ません)|確認できて(?:い|お)(?:ない|ません)|確認されて(?:い|お)(?:ない|ません)/;
const UNKNOWN_WORD = /不明/;
/** 推定を示す語（inferred の段階があるのに、一つも無ければ断定している疑いがある） */
const HEDGE = /考えられ|おそれ|恐れ|可能性|見込み|とみられ|思われ|かもしれ/;
const ID_PATTERN = /\bT\d{4}(?:\.\d{3})?\b|\bM\d{4}\b|UD-\d{2}|TA\d{4}/;
/** 「0日」「0 日」（10日や0日目は除く）。止まる業務が無いのに復旧日数を 0 日と書く癖を弾く */
const ZERO_DAYS = /(?<![\d.,])0\s*日(?!目)/;

/** 入力の数値から、出力に現れてよい数字の集合を作る（円は万・億の表記も） */
export function allowedNumbers(input: OnePagerWriterInput): Set<string> {
  const out = new Set<string>();
  const add = (v: number | undefined) => {
    if (v === undefined) return;
    out.add(String(v));
    out.add(v.toLocaleString("ja-JP"));
  };
  const yen = (v: number | undefined) => {
    if (v === undefined) return;
    add(v);
    if (v >= 10_000) add(Math.round(v / 10_000));
    if (v >= 100_000_000) {
      const oku = v / 100_000_000;
      add(Math.round(oku));
      add(Math.round(oku * 10) / 10);
      const rest = Math.round((v % 100_000_000) / 10_000);
      if (rest > 0) add(rest);
    }
  };
  add(input.downtimeDays);
  add(input.partnerImpactDay);
  for (const s of input.stopped) {
    add(s.days);
    add(s.manualDays);
  }
  yen(input.revenueImpactJpy);
  yen(input.moneyLossJpy);
  return out;
}

/** 出力に ID や入力にない数字が混じっていないか。問題があれば理由を返す */
export function checkWriterOutput(
  output: OnePagerWriterOutput,
  input: OnePagerWriterInput,
): string | undefined {
  const allowed = allowedNumbers(input);
  const sourceProblem = checkSourceWording(output, input);
  if (sourceProblem) return sourceProblem;
  for (const line of output.whatHappensJa) {
    if (ID_PATTERN.test(line)) return `ID が含まれています：${line}`;
    const normalized = line.replace(/[０-９]/g, (c) =>
      String.fromCharCode(c.charCodeAt(0) - 0xfee0),
    );
    if (input.stopped.length === 0 && ZERO_DAYS.test(normalized))
      return `止まる業務が無いのに「0日」と書かれています：${line}`;
    for (const m of normalized.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
      const num = m[0];
      if (!allowed.has(num) && !allowed.has(num.replace(/,/g, "")))
        return `入力にない数値が含まれています：${num}（${line}）`;
    }
  }
  // 止まる業務・金額（御社に当てはめた試算）は、記事の事実と別の文で「御社の場合は〜と見込まれます」と書く
  const hasEstimate =
    input.stopped.length > 0 ||
    input.revenueImpactJpy !== undefined ||
    input.moneyLossJpy !== undefined;
  const isEstimateLine = (l: string) =>
    (l.includes(ESTIMATE_PHRASE) ||
      (input.thirdPartyJa !== undefined && l.includes("御社が同じ立場"))) &&
    l.includes("見込まれ");
  if (hasEstimate && !output.whatHappensJa.some(isEstimateLine))
    return `止まる業務や金額は、「${ESTIMATE_PHRASE}〜と見込まれます」と記事の事実と分けて書いてください`;
  // 第三者の事故：「これは〇〇で起きた事故です」と書き、確認の言い方は「記事の〇〇では」で始める（御社の設備の事実にしない）
  if (input.thirdPartyJa !== undefined) {
    if (
      !output.whatHappensJa.some(
        (l) => l.includes("で起きた") && l.includes(input.thirdPartyJa as string),
      )
    )
      return `第三者の事故なのに、「これは${input.thirdPartyJa}で起きた事故です」と書かれていません`;
    // 確認の言い方を使う最初の文は、主語を記事の第三者にする（御社の設備の事実にしない）。続く文は、その主語を引き継ぐ
    const firstConfirm = output.whatHappensJa.find((l) => CONFIRM_RE.test(l));
    if (
      firstConfirm !== undefined &&
      !firstConfirm.includes("記事の") &&
      !firstConfirm.includes(input.thirdPartyJa as string)
    )
      return `第三者の事故の事実は「記事の${input.thirdPartyJa}では〜」と書いてください：${firstConfirm}`;
  }
  return undefined;
}

/**
 * 段階の確認状況（source / state）に合わない言い方を弾く。
 * - 否定の言い方（「確認が取れていません」など）は、固定の言い回し「この段階を止める対策が確認できていません」以外では使わせない
 * - 記載（stated）の段階があるなら、「不明」も使わせない
 * - 推定（inferred）の段階があるなら、推定を示す語（「考えられます」など）が必要
 * - 入口が候補（candidate）なら「入口はまだ分かっていません」が必要
 * - state が unknown の段階があるなら、固定の言い回しが必要
 */
export function checkSourceWording(
  output: OnePagerWriterOutput,
  input: OnePagerWriterInput,
): string | undefined {
  const hasStated = input.stages.some((s) => s.source === "stated");
  for (const line of output.whatHappensJa) {
    const rest = line
      .replaceAll(UNKNOWN_CONTROL_SHORT, "")
      .replaceAll(NO_TRACE_PHRASE, "")
      .replaceAll(EXPOSED_ONLY_PHRASE, "")
      .replace(CLAIMED_PHRASE_RE, "");
    if (DENIAL.test(rest))
      return `「確認が取れていません」のような言い方は、「${UNKNOWN_CONTROL_PHRASE}」以外では使えません：${line}`;
    if (hasStated && UNKNOWN_WORD.test(rest))
      return `記事に書かれた段階があるのに「不明」と書かれています：${line}`;
  }
  const all = output.whatHappensJa.join("");
  const uncertain = (c: StepCertainty) => input.stages.some((s) => s.certainty === c);
  if (uncertain("no_trace") && !all.includes(NO_TRACE_PHRASE))
    return `痕跡がない段階があるのに「${NO_TRACE_PHRASE}」と書かれていません`;
  if (uncertain("exposed_only") && !all.includes(EXPOSED_ONLY_PHRASE))
    return `閲覧できる状態だけの段階があるのに「${EXPOSED_ONLY_PHRASE}」と書かれていません`;
  if (uncertain("claimed") && !all.includes("主張"))
    return "攻撃者の主張の段階があるのに「主張」と書かれていません";
  if (input.stages.some((s) => s.published) && !all.includes("公開"))
    return "情報がすでに公開された段階があるのに「公開されています」と書かれていません";
  // 「確認されています」を使えるのは、記事が出来事として書いた段階（stated で確度の印が無い）があるときだけ
  const hasConfirmed = input.stages.some((s) => s.source === "stated" && !s.certainty);
  if (!hasConfirmed && CONFIRM_RE.test(all))
    return "記事で確認された出来事が無いのに「確認されています」と書かれています";
  for (const line of output.whatHappensJa) {
    if (CONFIRM_RE.test(line) && ESTIMATE_RE.test(line))
      return `御社に当てはめた試算の文に「確認されています」が使われています：${line}`;
  }
  // 推定を示す語が要るのは、推定の段階（確度の印が無い）と、可能性（possible）の段階だけ。
  // 痕跡なし・主張・閲覧できる状態だけの段階は、それぞれ固定の言い回しで書く
  if (
    input.stages.some(
      (s) => s.source === "inferred" && (s.certainty === undefined || s.certainty === "possible"),
    ) &&
    !HEDGE.test(all)
  )
    return "推定の段階を断定しています（「〜と考えられます」などの言い方がありません）";
  if (input.stages[0]?.source === "candidate" && !all.includes(CANDIDATE_ENTRY_PHRASE))
    return `入口が候補なのに「${CANDIDATE_ENTRY_PHRASE}」と書かれていません`;
  if (input.stages.some((s) => s.state === "unknown") && !all.includes(UNKNOWN_CONTROL_SHORT))
    return `対策が未確認の段階があるのに「${UNKNOWN_CONTROL_PHRASE}」と書かれていません`;
  return undefined;
}

export type WriteResult = StructuredResult<OnePagerWriterOutput> & {
  /** 検証で捨てた理由。undefined なら採用できる */
  rejectedReason?: string;
};

/** Claude に言い換えを頼む。検証に落ちた場合も結果は返す（rejectedReason つき） */
export async function writeOnePagerText(
  input: OnePagerWriterInput,
  options: LlmOptions = {},
): Promise<WriteResult> {
  const system: Anthropic.TextBlockParam[] = [{ type: "text", text: WRITER_RULES_JA }];
  const r = await callStructured<OnePagerWriterOutput>(
    { maxTokens: 1500, effort: "low", ...options },
    {
      system,
      user: `<verdict>\n${JSON.stringify(OnePagerWriterInput.parse(input), null, 1)}\n</verdict>\n\n上の判定結果を、社長向けの文にしてください。`,
      schema: onePagerWriterJsonSchema,
      parse: (v) => OnePagerWriterOutput.parse(v),
    },
  );
  const rejectedReason = checkWriterOutput(r.value, input);
  return rejectedReason ? { ...r, rejectedReason } : r;
}

/**
 * 文の中の「3000000円」「3,000,000円」を「300万円」の読みやすい形にする（1 万円ちょうどの倍数だけ。端数があれば桁区切りの円）。
 * 数値は変えず、書き方だけを整える（検証のあとに使う）
 */
export function formatYenInText(text: string): string {
  return text.replace(/(?<![\d.,])(\d[\d,]*)\s*円/g, (all, digits: string) => {
    const v = Number(digits.replace(/,/g, ""));
    if (!Number.isFinite(v) || v < 10_000) return all;
    if (v % 10_000 !== 0) return `${v.toLocaleString("ja-JP")}円`;
    const man = v / 10_000;
    if (man < 10_000) return `${man.toLocaleString("ja-JP")}万円`;
    const oku = Math.floor(man / 10_000);
    const rest = man % 10_000;
    return `${oku.toLocaleString("ja-JP")}億${rest > 0 ? `${rest.toLocaleString("ja-JP")}万` : ""}円`;
  });
}

/** 一枚の whatHappensJa を Claude の文に差し替える（検証に落ちたら元のまま） */
export function applyWriterOutput(onePager: OnePager, result: WriteResult): OnePager {
  if (result.rejectedReason) return onePager;
  return { ...onePager, whatHappensJa: result.value.whatHappensJa.map(formatYenInText) };
}
