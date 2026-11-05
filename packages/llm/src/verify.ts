/**
 * 読解結果の検証（プログラムが決定的に行う）。
 * 1. zod で形を検証。定義にない被害の種類（damage-types.yaml）は拒否
 * 2. 手法 ID を canonicalTechnique で正規化（廃止 ID は置き換え、存在しない ID は破棄）
 * 3. 根拠文が原文に実在するか文字列照合（空白・全角半角の揺れを吸収）。無ければ quote を消し inferred に落とす。
 *    短すぎる・長すぎる根拠文、stated 以外の段階に付いた根拠文も消す（根拠文があるのは stated だけ、という不変条件）
 * 4. allowedTechniques（型紙にある手法）があれば、それ以外を破棄。推定の段階が型紙外の手法だけでできていれば段階ごと破棄
 *    （「推定段階の補完は型紙の範囲内」）
 * 5. 記事中の指示らしき文を検知して suspiciousInstructions に残す
 *
 * ここで守れないもの：damageType・clarity・段階の有無そのものは Claude の判断で、記事中の指示に従って変えられても
 * 検証では見分けられない。その防御はプロンプト（RULES_JA）と、検知した指示文の画面表示に頼る
 */
import {
  type AttackData,
  Case,
  type CaseStep,
  canonicalTechnique,
  loadDamageTypes,
  loadEntryKinds,
  loadLeakKinds,
  loadVictims,
  OUT_OF_SCOPE,
  type StepCertainty,
  yenAppearsIn,
} from "@uchidai/engine";
import { dedupeInstructions, detectInstructions } from "./injection.ts";
import { RawCase } from "./schema.ts";

// 指示らしき文の検知は injection.ts に分けた。呼び出し側の import はそのまま使えるよう、ここからも出す
export { detectInstructions };

/** 空白と全角半角の揺れを吸収して照合する（eval/src/score.ts の normalizeText と同じ規則） */
export function normalizeText(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .replace(/[「」『』“”"'、。．，,.]/g, "");
}

export type VerifyOptions = {
  /** 型紙にある手法。渡されたときはこれ以外の手法を破棄する */
  allowedTechniques?: Iterable<string>;
  /** 定義済みの被害の種類の id（既定は knowledge/damage-types.yaml）。これと out_of_scope 以外は拒否する */
  damageTypes?: Iterable<string>;
  url?: string;
  /** 記事のタイトル。根拠文の照合に使う（本文に無くタイトルにだけある根拠文は、確認された事実としては扱わない） */
  title?: string;
  /** 定義済みの入口の種類の id（既定は knowledge/entry-kinds.yaml）。これ以外は捨てる */
  entryKinds?: Iterable<string>;
  /** 定義済みの被害を受けた側の id（既定は knowledge/victims.yaml）。これ以外は捨てる */
  victims?: Iterable<string>;
  /** 定義済みの漏えいした情報の種類の id（既定は knowledge/leak-kinds.yaml）。これ以外は捨てる */
  leakKinds?: Iterable<string>;
  /** これより短い根拠文（正規化後の文字数）は照合しない（既定 8） */
  minQuoteLength?: number;
  /** これより長い根拠文（正規化後の文字数）は捨てる（既定 400。「1〜2 文」の約束を守らせる） */
  maxQuoteLength?: number;
};

/** 表示に使う文字列の上限（Claude の出力が際限なく長くならないように） */
const MAX_TITLE = 200;
const MAX_SUMMARY = 300;

export type VerifyReport = {
  /** 破棄した段階と理由：存在しない戦術 ID、または推定の段階が型紙外の手法だけだった */
  droppedSteps: {
    index: number;
    tactic: string;
    reason: "unknown_tactic" | "inferred_outside_template";
  }[];
  /** 廃止 ID を置き換えた手法 */
  replacedTechniques: { index: number; from: string; to: string }[];
  /** 破棄した手法と理由 */
  droppedTechniques: {
    index: number;
    id: string;
    reason: "unknown_id" | "not_in_template" | "duplicate";
  }[];
  /** 手法の戦術が段階の戦術と一致しない（警告。破棄はしない） */
  tacticMismatches: { index: number; id: string; tactic: string }[];
  /** 消した根拠文と理由：原文に無い、短すぎる、長すぎる、stated 以外の段階に付いていた */
  droppedQuotes: {
    index: number;
    quote: string;
    reason: "not_in_article" | "too_short" | "too_long" | "source_not_stated";
  }[];
  /** stated なのに根拠文が無く inferred に落とした段階 */
  statedWithoutQuote: number[];
  /** 記事の書き方（可能性・痕跡なし・主張など）から、stated を inferred / unknown に下げた段階と、その確度 */
  downgraded: { index: number; certainty: StepCertainty }[];
  /** 根拠文がタイトルにしか無く、stated を inferred に下げた段階 */
  titleOnlyQuotes: number[];
  /** 記事に見当たらないので捨てた被害額（円。読解が写した値が、記事の円の金額のどれにも一致しなかった） */
  droppedReportedLoss?: number;
  /** 読解が averted（被害を防げた）を true にしたが、記事に未遂・阻止・被害は発生しなかった旨の語が無いので false にした（TRIAL-I-003） */
  droppedAverted?: true;
  /** 捨てた漏えいした情報の種類（定義にない値） */
  droppedLeakedData?: string[];
  /** 捨てた被害を受けた側（定義にない値） */
  droppedVictim?: string;
  /** 捨てた入口の種類：定義にない種類、入口以外の段階、入口が不明の段階に付いていたもの */
  droppedEntryKinds: { index: number; kind: string }[];
  /** 入口の手段に触れていない根拠文のために外した手法 */
  unsupportedEntryTechniques: { index: number; id: string }[];
  /** 検知した指示らしき文（Claude の報告と、プログラムの検知の和） */
  suspiciousInstructions: string[];
  /** Claude が報告したが原文に無かった指示文（捏造の可能性。破棄） */
  droppedSuspicious: string[];
  /** 画面で注意を出すべき状態（日本語） */
  warnings: string[];
  counts: {
    stepsIn: number;
    stepsOut: number;
    techniquesIn: number;
    techniquesOut: number;
    quotesIn: number;
    quotesOut: number;
  };
};

export type VerifiedCase = { case: Case; report: VerifyReport };

function clip(s: string, max: number): string {
  const t = s.trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

// ---------------------------------------------------------------------------
// 出来事の確度（certainty）。記事の書き方から、プログラムが決定的に補正する。
// 読解（Claude）が stated を付けても、「可能性」「痕跡は確認されず」「主張」「記載なし」の語があれば stated にしない
// ---------------------------------------------------------------------------
/** 否定：「痕跡は確認されず」「確認されていない」 */
const NO_TRACE =
  /痕跡(は|も|が)?(確認|見つか|認め)(され|でき)?(て(い|お)(ない|ません)|ず|なかっ|ませんでし)|(形跡|被害)(は|が)?(確認|見つか|認め)(され|でき)?(て(い|お)(ない|ません)|ず|なかっ)|確認(され|でき)て(い|お)(ない|ません)|確認(され|でき)(ず|なかっ)|見つかって(い|お)(ない|ません)|認められ(ない|ず)/;
/** 可能性：「可能性がある」「おそれ」「とみられる」「考えられる」 */
const POSSIBLE =
  /(可能性|おそれ|恐れ)(が|は|も)?(ある|あり|高|否定でき|否定され)(?![ァ-ヶ一-龥ー])|可能性(を|も|が)(排除|否定)|とみられ|と見られ|思われ|考えられ|疑われ|疑いが(ある|あり)|調査中ですが/;
/**
 * 入口の段階で、複文の文末の述語が「可能性」を表すもの（TRIAL-I-001）。IR は「〜が起点となり、〜された可能性があることが判明」
 * のように、可能性が文末の別の節にかかる複文で書く。「A が起点となり B された可能性」は、B が可能性なら起点の A も可能性なので、
 * 入口の根拠文に「起点」の語があるときだけ、文末の可能性を入口全体にかける。起点の語が無い
 * 「VPN 経由でアクセスが行われ、情報を参照された可能性がある」は、可能性が別の出来事（収集）の話なので下げない（今の安全弁）
 */
const ENTRY_ORIGIN = /起点|端緒|発端|きっかけ|契機/;
const ENTRY_TAIL_POSSIBLE =
  /(可能性|おそれ|恐れ)(が|は|も)?(ある|あり|高|否定でき|否定され)|と(推定|推測|推察|考えられ|みられ|見られ)/;
/** 攻撃者側の主張 */
const CLAIMED = /主張|犯行声明|声明を|名乗|自称/;
/** 閲覧できる状態だった（取得は別） */
const EXPOSED = /閲覧(でき|可能)|アクセス(でき|可能)|公開(状態|されて)|状態(だった|となっ|が続|で)/;
/** 記事に書かれていない：どの段階でも使う強い言い方 */
const NOT_STATED =
  /(記載|言及|記述)(が|は|も)?(な(い|し)|無(い|し))|書かれていない|記載されていない|触れられていない/;
/** 持ち出された情報が公開された：リークサイトへの掲載、公開済み */
const PUBLISHED =
  /公開(された|され|済み|して)|掲載(された|され|して)|リークサイト|闇サイト|ダークウェブ/;
/**
 * なりすましの段階（T1684 など）で装った相手（TRIAL-B-005）。取引先・仕入先・顧客などを装ったと書かれ、
 * 社長・役員などを装ったとは書かれていないときだけ partner にする（両方あるときや、どちらも無いときは既定の社長のまま）
 */
const IMPERSONATION_TECHNIQUE = /^T1684(\.|$)|^T1656(\.|$)/;
const PARTNER_WORDS =
  /取引先|仕入先|仕入れ先|納入先|発注元|得意先|顧客|請負先|委託先|協力会社|下請け|サプライヤ|関係会社|取引相手/;
const EXEC_WORDS = /社長|代表(取締役|者)?|役員|経営者|経営陣|CEO|CFO|幹部|上司|オーナー/;
/** 被害を防げた（未遂・阻止・被害は発生しなかった）と書く語。averted を残してよいのは、本文にこのどれかがあるときだけ */
const AVERTED_WORDS =
  /未遂|未然|防(げ(?!なかっ)|い)|被害(は|が)(発生し|生じ)(なかった|てい(ない|ません)|ておりません)|被害(は|には|に)(至|出)(らなかっ|なかっ|ませんでし)|送金前|阻止/;
/**
 * 続報で、この文書だけでは種類が分からない公表か（TRIAL-I-005）。Claude の出力は信じず、本文と題から決定的に決める。
 * 読解が out_of_scope で、本文にサイバー攻撃・不正アクセス・ランサムウェアの語があり、題か本文に続報の印があるとき。
 * 続報の印は、「続報」「最終報」「第 2 報」以降。「第 1 報」はこの文書自身か前の報の呼び名で、続報の印にしない。
 * 「続報を公表いたします」のように、これから出す予告の言い方は、この文書が続報だという意味ではないので除く
 */
const ATTACK_WORDS = /サイバー攻撃|不正アクセス|ランサムウェア/;
const FOLLOW_UP_MARK = /(続報|最終報|第([0-9]+|[一二三四五六七八九十]+)報)/g;
const FOLLOW_UP_FUTURE =
  /^.{0,12}?(お知らせ|ご報告|報告|公表|開示|発表|ご案内)(いたします|致します|します|してまいります|させていただきます|する予定|予定)/;
export function isFollowUpWithoutKind(text: string, title = ""): boolean {
  const n = normalizeText(`${title}\n${text}`);
  if (!ATTACK_WORDS.test(n)) return false;
  for (const m of n.matchAll(FOLLOW_UP_MARK)) {
    if (m[2] === "一" || (/^[0-9]+$/.test(m[2] ?? "") && Number(m[2]) <= 1)) continue;
    const after = n.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 24);
    if (FOLLOW_UP_FUTURE.test(after)) continue;
    return true;
  }
  return false;
}

/** 入口の段階だけで使う弱い言い方 */
const ENTRY_UNKNOWN =
  /不明|明らか(に|で)(は|も)?(されて)?(い)?(な|おら)|特定(されて|できて)(い|お)(ない|らず|ません)|公表(されて|して)(い|お)(ない|らず|ません)|分かって(い|お)(ない|らず|ません)/;

/** 入口の手段に当たる語（手法の系統ごと）。根拠文がこれに触れていなければ、その手法は根拠が無い */
const ENTRY_MEANS: [prefix: string, re: RegExp][] = [
  [
    "T1190",
    /脆弱性|VPN|ＶＰＮ|UTM|ファイアウォール|ルータ|ゲートウェイ|ネットワーク機器|機器|装置|公開|サイト|ウェブ|Web|サーバ|アプリ|ソフトウェア|セキュリティホール|ゼロデイ|CVE|インジェクション|システム/i,
  ],
  ["T1133", /VPN|ＶＰＮ|リモート|遠隔|RDP|テレワーク|外部から|保守用|ログイン|接続|経由/i],
  ["T1078", /アカウント|認証情報|ID|ＩＤ|パスワード|ログイン|資格情報|クレデンシャル|ユーザー/i],
  ["T1566", /メール|フィッシング|添付|リンク|URL|ＵＲＬ|SMS|メッセージ|詐欺/i],
  [
    "T1199",
    /委託|取引先|保守|ベンダー|協力会社|グループ会社|関連会社|子会社|パートナー|業者|事業者/,
  ],
];

/**
 * 記事の書き方から、段階の確度を決める（優先順：記載なし → 否定 → 主張 → 可能性）。
 * 判定の材料は、Claude の根拠文（quote）と一行の説明（summaryJa）。confirmed の段階だけが stated を保てる
 */
export function certaintyFromText(
  quote: string | null,
  summaryJa: string,
  tactic: string,
): StepCertainty {
  // 根拠文は、一つの節だけの短い文のときだけ見る（複数の節がある文の「可能性」は、別の出来事にかかっていることがある）。
  // 一行の説明（summaryJa）は、その段階の出来事だけを書いたものなので、いつも見る
  const oneClause = quote !== null && !/[、，,]/.test(quote.replace(/[。.]$/, ""));
  const text = `${oneClause ? (quote ?? "") : ""}\n${summaryJa}`;
  // 入口の段階だけ：根拠文が「起点」を述べ、複文の文末の述語が可能性を表すなら、可能性にとどまる入口として扱う
  const entryTailPossible =
    tactic === "TA0001" &&
    quote !== null &&
    ENTRY_ORIGIN.test(quote) &&
    ENTRY_TAIL_POSSIBLE.test(lastClause(quote));
  if (NOT_STATED.test(summaryJa) || (tactic === "TA0001" && ENTRY_UNKNOWN.test(summaryJa)))
    return "not_stated";
  if (NO_TRACE.test(text)) return EXPOSED.test(text) ? "exposed_only" : "no_trace";
  if (CLAIMED.test(text)) return "claimed";
  if (POSSIBLE.test(text) || entryTailPossible) return "possible";
  return "confirmed";
}

/** 文章の最後の文の、最後の節（最後の「、」のあと）。文末の述語を見るために使う */
function lastClause(text: string): string {
  const sentences = text
    .split(/[。.！!？?]/)
    .map((x) => x.trim())
    .filter((x) => x !== "");
  const last = sentences[sentences.length - 1] ?? "";
  const parts = last.split(/[、，,]/);
  return parts[parts.length - 1] ?? "";
}

export function verifyCase(
  raw: unknown,
  articleText: string,
  attack: AttackData,
  options: VerifyOptions = {},
): VerifiedCase {
  const parsed = RawCase.parse(raw);
  const knownTypes = new Set(options.damageTypes ?? loadDamageTypes().map((d) => d.id));
  if (parsed.damageType !== OUT_OF_SCOPE && !knownTypes.has(parsed.damageType))
    throw new Error(`未定義の被害の種類: ${parsed.damageType}`);
  const normalizedArticle = normalizeText(articleText);
  const normalizedTitle = options.title ? normalizeText(options.title) : "";
  const minQuote = options.minQuoteLength ?? 8;
  const maxQuote = options.maxQuoteLength ?? 400;
  const knownLeakKinds = new Set(options.leakKinds ?? loadLeakKinds().map((l) => l.id));
  const knownVictims = new Set(options.victims ?? loadVictims().map((v) => v.id));
  const knownKinds = new Set(options.entryKinds ?? loadEntryKinds().map((k) => k.id));
  const allowed = options.allowedTechniques ? new Set(options.allowedTechniques) : undefined;
  const tacticIds = new Set(attack.tactics.map((t) => t.id));
  const techniqueTactics = new Map(attack.techniques.map((t) => [t.id, t.tactics]));

  const report: VerifyReport = {
    droppedSteps: [],
    replacedTechniques: [],
    droppedTechniques: [],
    tacticMismatches: [],
    droppedQuotes: [],
    statedWithoutQuote: [],
    downgraded: [],
    titleOnlyQuotes: [],
    droppedEntryKinds: [],
    unsupportedEntryTechniques: [],
    suspiciousInstructions: [],
    droppedSuspicious: [],
    warnings: [],
    counts: {
      stepsIn: parsed.steps.length,
      stepsOut: 0,
      techniquesIn: parsed.steps.reduce((n, s) => n + s.techniques.length, 0),
      techniquesOut: 0,
      quotesIn: parsed.steps.filter((s) => s.quote !== null).length,
      quotesOut: 0,
    },
  };

  const steps: CaseStep[] = [];
  parsed.steps.forEach((s, index) => {
    const tactic = s.tactic.trim().toUpperCase();
    if (!tacticIds.has(tactic)) {
      report.droppedSteps.push({ index, tactic: s.tactic, reason: "unknown_tactic" });
      return;
    }

    const techniques: string[] = [];
    let outsideTemplate = 0;
    for (const rawId of s.techniques) {
      const id = rawId.trim().toUpperCase();
      const canonical = canonicalTechnique(id, attack);
      if (!canonical) {
        report.droppedTechniques.push({ index, id: rawId, reason: "unknown_id" });
        continue;
      }
      if (canonical !== id) report.replacedTechniques.push({ index, from: id, to: canonical });
      if (allowed && !allowed.has(canonical)) {
        report.droppedTechniques.push({ index, id: canonical, reason: "not_in_template" });
        outsideTemplate += 1;
        continue;
      }
      if (techniques.includes(canonical)) {
        report.droppedTechniques.push({ index, id: canonical, reason: "duplicate" });
        continue;
      }
      const tactics = techniqueTactics.get(canonical);
      if (tactics && !tactics.includes(tactic))
        report.tacticMismatches.push({ index, id: canonical, tactic });
      techniques.push(canonical);
    }
    // 推定で補った段階が、型紙にない手法だけでできていたなら、型紙の範囲外の補完として段階ごと破棄する
    // （unknown の段階は「入口が不明」のように手法が無くても意味を持つので残す）
    if (s.source === "inferred" && outsideTemplate > 0 && techniques.length === 0) {
      report.droppedSteps.push({ index, tactic, reason: "inferred_outside_template" });
      return;
    }

    // 出来事の確度：Claude が付けた値と、記事の書き方の語から決めた値の、確度が低いほうを採る
    let certainty: StepCertainty = s.certainty ?? "confirmed";
    if (s.source !== "unknown") {
      const fromText = certaintyFromText(s.quote, s.summaryJa, tactic);
      if (certainty === "confirmed") certainty = fromText;
    }
    let source: CaseStep["source"] = s.source;
    let stepTechniques = techniques;
    if (certainty === "not_stated") {
      // 記事に書かれていない（入口の方法など）：手法を付けず、不明にそろえる
      source = "unknown";
      stepTechniques = [];
      if (s.source !== "unknown") report.downgraded.push({ index, certainty });
    } else if (certainty !== "confirmed" && source === "stated") {
      // 可能性・痕跡なし・主張・閲覧できる状態だけ：記事が出来事として書いたものではないので、stated にしない
      source = "inferred";
      report.downgraded.push({ index, certainty });
    }

    // 根拠文があるのは stated か、確度が confirmed 以外の推定の段階だけ
    const quoteAllowed =
      certainty !== "not_stated" &&
      (s.source === "stated" || (certainty !== "confirmed" && s.source !== "unknown"));
    let quote: string | undefined;
    let quoteOnlyInTitle = false;
    if (s.quote !== null && s.quote.trim() !== "") {
      const q = normalizeText(s.quote);
      if (!quoteAllowed)
        report.droppedQuotes.push({ index, quote: s.quote, reason: "source_not_stated" });
      else if (q.length < minQuote)
        report.droppedQuotes.push({ index, quote: s.quote, reason: "too_short" });
      else if (q.length > maxQuote)
        report.droppedQuotes.push({ index, quote: clip(s.quote, 200), reason: "too_long" });
      else if (normalizedArticle.includes(q)) quote = s.quote;
      else if (normalizedTitle.includes(q)) {
        quote = s.quote;
        quoteOnlyInTitle = true;
      } else report.droppedQuotes.push({ index, quote: s.quote, reason: "not_in_article" });
    }
    if (quoteOnlyInTitle && source === "stated") {
      // 根拠がタイトルだけ（本文に出来事の記述が無い）：確認された事実としては扱わない
      source = "inferred";
      report.titleOnlyQuotes.push(index);
    }
    if (source === "stated" && quote === undefined) {
      if (s.quote === null || s.quote.trim() === "") report.statedWithoutQuote.push(index);
      source = "inferred";
    }
    // 入口の段階：根拠文が入口の手段に触れていない手法は外す（記事にない手口が根拠つきの顔で残らないように）
    if (source === "stated" && tactic === "TA0001" && quote !== undefined) {
      const kept: string[] = [];
      for (const id of stepTechniques) {
        const means = ENTRY_MEANS.find(([prefix]) => id.startsWith(prefix));
        if (means && !means[1].test(quote)) report.unsupportedEntryTechniques.push({ index, id });
        else kept.push(id);
      }
      if (stepTechniques.length > 0 && kept.length === 0) {
        source = "unknown";
        certainty = "not_stated";
        report.downgraded.push({ index, certainty });
        quote = undefined;
      }
      stepTechniques = kept;
    }

    const step: CaseStep = { tactic, techniques: stepTechniques, source };
    // 入口の種類は、入口（TA0001）の段階で、入口が分かっているときだけ残す
    if (s.entryKind) {
      if (tactic === "TA0001" && source !== "unknown" && knownKinds.has(s.entryKind))
        step.entryKind = s.entryKind;
      else report.droppedEntryKinds.push({ index, kind: s.entryKind });
    }
    if (certainty !== "confirmed") step.certainty = certainty;
    // 持ち出しが確認され、その情報が公開されたと書かれている（二重恐喝）：一枚で「すでに公開されています」と書く
    if (
      certainty === "confirmed" &&
      tactic === "TA0010" &&
      source !== "unknown" &&
      PUBLISHED.test(`${s.quote ?? ""}\n${s.summaryJa}`)
    )
      step.published = true;
    // なりすましの段階：装った相手が取引先で、社長ではないとき（型紙の段階の札を取引先の言い方にする）
    if (source !== "unknown" && stepTechniques.some((id) => IMPERSONATION_TECHNIQUE.test(id))) {
      const said = `${s.quote ?? ""}\n${s.summaryJa}`;
      if (PARTNER_WORDS.test(said) && !EXEC_WORDS.test(said)) step.impersonates = "partner";
    }
    if (quote !== undefined) step.quote = quote;
    if (s.summaryJa.trim()) step.summaryJa = clip(s.summaryJa, MAX_SUMMARY);
    steps.push(step);
  });

  // 被害を受けた側：定義済みの値だけ残す。self は省略と同じなので持たせない（従来の Case と同じ形）
  let victim: string | undefined;
  if (parsed.victim) {
    if (!knownVictims.has(parsed.victim)) report.droppedVictim = parsed.victim;
    else if (parsed.victim !== "self") victim = parsed.victim;
  }

  // 漏えいした情報の種類：定義済みの値だけ残す（重複は 1 つに）
  const leakedData: string[] = [];
  for (const id of parsed.leakedData ?? []) {
    if (!knownLeakKinds.has(id)) {
      report.droppedLeakedData = [...(report.droppedLeakedData ?? []), id];
    } else if (!leakedData.includes(id)) leakedData.push(id);
  }

  // 記事が書く被害額：記事の円の金額のどれかと一致するときだけ残す（Claude は金額を読んで写すだけ。作った値は捨てる）
  let reportedLossJpy: number | undefined;
  const claimed = parsed.reportedLossJpy;
  if (claimed !== null && claimed !== undefined) {
    if (
      Number.isInteger(claimed) &&
      claimed > 0 &&
      yenAppearsIn(claimed, `${articleText}\n${options.title ?? ""}`)
    )
      reportedLossJpy = claimed;
    else report.droppedReportedLoss = claimed;
  }

  // 被害を防げた（averted）：未遂・阻止・被害は発生しなかったと書かれた記事だけ。「漏えいの事実は確認されていない」
  // 「可能性にとどまる」は、被害が確定していないだけなので未遂ではない（TRIAL-I-003）
  let averted = parsed.averted === true;
  if (averted && !AVERTED_WORDS.test(normalizeText(`${articleText}\n${options.title ?? ""}`))) {
    averted = false;
    report.droppedAverted = true;
  }

  const detected = detectInstructions(articleText);
  const reported: string[] = [];
  for (const line of parsed.suspiciousInstructions) {
    const n = normalizeText(line);
    if (n.length >= 4 && normalizedArticle.includes(n)) reported.push(clip(line, 200));
    else report.droppedSuspicious.push(line);
  }
  report.suspiciousInstructions = dedupeInstructions(
    [...new Set([...reported, ...detected])],
    normalizeText,
  );

  report.counts.stepsOut = steps.length;
  report.counts.techniquesOut = steps.reduce((n, s) => n + s.techniques.length, 0);
  report.counts.quotesOut = steps.filter((s) => s.quote !== undefined).length;

  // 攻撃の記事でない（out_of_scope）と読んで段階が 0 なのは、読み取りの失敗ではなく想定どおり。警告にしない（TRIAL-S-009）。
  // 画面は damageType が out_of_scope で段階が 0 のとき「攻撃の記事ではないと判断しました」と出す
  if (steps.length === 0) {
    if (parsed.damageType !== OUT_OF_SCOPE)
      report.warnings.push("攻撃の段階を 1 つも読み取れませんでした");
  } else if (allowed && report.counts.techniquesIn > 0 && report.counts.techniquesOut === 0)
    report.warnings.push(
      `読み取った手法がすべて被害の型（${parsed.damageType}）の型紙にありません。記事の型と型紙が合っていない可能性があります`,
    );
  if (report.tacticMismatches.length > 0)
    report.warnings.push(
      `手法が段階の戦術に合わない読み取りが ${report.tacticMismatches.length} 件あります（${[...new Set(report.tacticMismatches.map((m) => m.id))].join("、")}）。段階の対応づけを確認してください`,
    );
  if (report.suspiciousInstructions.length > 0)
    report.warnings.push(
      `記事の中に指示らしき文が ${report.suspiciousInstructions.length} 件ありました。判定には使っておらず、読解の結果は変わりませんが、念のためご確認ください`,
    );

  const c: Case = Case.parse({
    ...(options.url ? { url: options.url } : {}),
    title: clip(parsed.title, MAX_TITLE),
    damageType: parsed.damageType,
    clarity: parsed.clarity,
    steps,
    suspiciousInstructions: report.suspiciousInstructions,
    ...(victim ? { victim } : {}),
    ...(leakedData.length > 0 ? { leakedData } : {}),
    ...(reportedLossJpy !== undefined ? { reportedLossJpy } : {}),
    ...(averted ? { averted: true } : {}),
    ...(parsed.damageType === OUT_OF_SCOPE && isFollowUpWithoutKind(articleText, options.title)
      ? { needsPrevious: true }
      : {}),
  });
  return { case: c, report };
}
