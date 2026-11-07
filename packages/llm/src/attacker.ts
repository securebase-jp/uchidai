/**
 * AI攻撃者（下見エージェント）。Claude は「探す」だけ：抽象化カルテと ATT&CK の手法一覧を読み、
 * 型紙にない侵入経路の候補を、役割の並びと手法 ID と一行の理由で返す。
 *
 * 安全：手法の水準まで（手順・コマンド・コード・製品名を書かせない）。外部通信やツール実行の権限は与えない
 * （Claude に渡すのは文章だけで、tool use も MCP も使わない）。出力は zod で検証し、禁止語を含む行は破棄する。
 * 採否は engine の validateAiPath（手法 ID・役割・つながり・判定ルールの 4 点）が決める
 */
import type Anthropic from "@anthropic-ai/sdk";
import {
  type AiPathCandidate,
  AiPathCandidate as AiPathCandidateSchema,
  type AiPathValidation,
  type AttackData,
  type AttackPath,
  type CompanyProfile,
  type Graph,
  type Knowledge,
  type LabelsFile,
  type Rule,
  type Template,
  type ValidateAiPathOptions,
  validateAiPath,
} from "@uchidai/engine";
import { z } from "zod";
import { type AbstractedProfile, renderAbstracted } from "./attacker-abstract.ts";
import { checkLineAgainst } from "./attacker-safety.ts";
import { callStructured, type LlmOptions } from "./client.ts";

export const ATTACKER_VERSION = "v2";
/** 候補数の上限（maxPaths はこれ以上にできない） */
export const MAX_PATHS = 5;
/** v1：役割と手法の一覧だけ → core の手法に T1078 を選び、判定ルールが無く破棄。v2：役割ごとに判定できる手法の表を渡す */

/** 下見で参照する戦術（初期アクセス、永続化、権限昇格、認証情報アクセス、横展開、収集、持ち出し、影響） */
export const RECON_TACTICS = [
  "TA0001",
  "TA0003",
  "TA0004",
  "TA0006",
  "TA0008",
  "TA0009",
  "TA0010",
  "TA0040",
] as const;

export const ATTACKER_RULES_JA = `あなたは、中小企業の情報システム担当者を助けるための「下見役」です。与えられた会社の構成（役割の枠と属性の要約だけ。社名・製品名・ホスト名はありません）と MITRE ATT&CK Enterprise の手法一覧を読み、担当者がまだ気づいていない侵入経路の候補を挙げます。候補は担当者が対策を優先する材料になります。

## 絶対に守ること（手法の水準まで）
- 書いてよいのは、役割の枠の ID、ATT&CK の手法 ID、各段階の理由の一行だけ
- 実際の攻撃手順、コマンド、コード、設定の操作方法、ツール名、製品名、CVE 番号、URL、IP アドレスは一切書かない。手法の名前の水準（例：「外部リモートサービス」「信頼関係の悪用」）で止める
- 役割 ID と手法 ID 以外の固有名詞を書かない
- 理由は日本語で 1 行（60 字程度、最大 120 字）。「この属性と対策の欠けがあるので、この手法でこの役割を通れる」の形で書く

## 経路の作り方
- 各段階は { role, technique, reasonJa }。role は <profile> にある役割 ID だけ、technique は「使える手法の一覧」にある ID だけ
- 最初の役割は attacker とつながっている役割。以降の各役割は直前の役割と「つながる役割」で結ばれていること
- 最後の役割は目標の役割（core など）で終える。2〜5 段階
- 「役割ごとに判定できる手法」の表にある役割と手法の組み合わせだけを使う。表にない組み合わせはプログラムの検証で破棄される（例：core で終えるなら core の行にある手法）
- 型紙（すでに判定済みの典型経路）と同じ入口は避ける：VPN装置（entry.vpn）からの侵入、社長のメールアカウント（cloud.mail_account.exec）からのなりすまし送金、クラウドストレージ（cloud.storage）の設定ミス。これら以外の入口から始める
- 候補は最大 3 本。有望な順。属性に「なし」「未確認」「常時接続」「共通パスワード」などの弱さが見える役割を優先する
- 出力は JSON スキーマどおり`;

export const aiPathsJsonSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["paths"],
  properties: {
    paths: {
      type: "array",
      description: "侵入経路の候補（最大 3 本、有望な順）",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["titleJa", "steps"],
        properties: {
          titleJa: { type: "string", description: "経路の短い題（日本語、30 字以内）" },
          steps: {
            type: "array",
            description: "入口から目標までの段階（2〜5 段階）",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["role", "technique", "reasonJa"],
              properties: {
                role: { type: "string", description: "役割 ID（<profile> にあるものだけ）" },
                technique: { type: "string", description: "ATT&CK 手法 ID（一覧にあるものだけ）" },
                reasonJa: {
                  type: "string",
                  description: "この段階を通れる理由の一行（日本語、120 字以内）",
                },
              },
            },
          },
        },
      },
    },
  },
};

const RawPaths = z.object({
  paths: z.array(
    z.object({
      titleJa: z.string(),
      steps: z.array(z.object({ role: z.string(), technique: z.string(), reasonJa: z.string() })),
    }),
  ),
});
type RawPaths = z.infer<typeof RawPaths>;

/** 下見で使う手法一覧（関連する戦術だけ。ID と名前、あれば日本語ラベル） */
export function renderReconTechniques(attack: AttackData, labels?: LabelsFile): string {
  const live = attack.techniques.filter((t) => !t.revoked && !t.deprecated);
  const lines = [
    `## 使える手法の一覧（MITRE ATT&CK Enterprise v${attack.version}、下見に関係する戦術だけ）`,
    "ここにある ID だけを使うこと。",
  ];
  for (const tid of RECON_TACTICS) {
    const tactic = attack.tactics.find((t) => t.id === tid);
    if (!tactic) continue;
    const ja = labels?.tactics[tid];
    lines.push("", `### ${tid} ${tactic.name}${ja ? `｜${ja}` : ""}`);
    for (const t of live
      .filter((t) => t.tactics.includes(tid))
      .sort((a, b) => a.id.localeCompare(b.id))) {
      const l = labels?.techniques[t.id];
      lines.push(`- ${t.id} ${t.name}${l ? `｜${l}` : ""}`);
    }
  }
  return lines.join("\n");
}

/** 型紙の一覧（避けるべき既知の経路として渡す）。入口は型紙の最初の役割（VPN、社長のメール、クラウドストレージ） */
export function renderKnownTemplates(templates: Template[]): string {
  const lines = ["## 型紙（判定済みの典型経路。これと同じ入口は避ける）"];
  for (const t of templates) {
    const entry = t.stages.find((s) => s.entry);
    const first = entry ? Object.keys(entry.byRole)[0] : undefined;
    if (first) lines.push(`- ${t.labelJa}：入口 ${first}`);
  }
  return lines.join("\n");
}

/**
 * 役割ごとに判定ルールで評価できる手法（engine の 4 点検証 (d) と同じ条件）。
 * 役割の既定ルール（手法を問わない）は、型紙がその役割の典型手法として挙げる手法にだけ使える
 */
export function renderEvaluableTechniques(rules: Rule[], templates: Template[]): string {
  const byRole = new Map<string, Set<string>>();
  const typical = (role: string) => {
    const out = new Set<string>();
    for (const t of templates)
      for (const s of t.stages) {
        // 取引先・提供元の停止の入口は攻撃者の経路ではない（AI 攻撃者の手法の表に混ぜない）
        if (s.fromPartner) continue;
        const tech = s.byRole[role];
        if (tech) out.add(tech);
        if (role in s.byRole) for (const a of s.accepts) out.add(a);
      }
    return out;
  };
  for (const r of rules) {
    const set = byRole.get(r.role) ?? new Set<string>();
    const ids = r.techniques.length > 0 ? r.techniques : [...typical(r.role)];
    for (const id of ids) set.add(id);
    byRole.set(r.role, set);
  }
  const lines = ["## 役割ごとに判定できる手法（この組み合わせだけが採用される）"];
  for (const [role, ids] of byRole)
    if (ids.size > 0) lines.push(`- ${role}：${[...ids].sort().join("、")}`);
  return lines.join("\n");
}

export function buildAttackerSystem(
  attack: AttackData,
  options: { labels?: LabelsFile; templates?: Template[]; rules?: Rule[] } = {},
): Anthropic.TextBlockParam[] {
  const blocks: Anthropic.TextBlockParam[] = [{ type: "text", text: ATTACKER_RULES_JA }];
  if (options.templates && options.templates.length > 0)
    blocks.push({ type: "text", text: renderKnownTemplates(options.templates) });
  if (options.rules && options.rules.length > 0)
    blocks.push({
      type: "text",
      text: renderEvaluableTechniques(options.rules, options.templates ?? []),
    });
  blocks.push({
    type: "text",
    text: renderReconTechniques(attack, options.labels),
    cache_control: { type: "ephemeral" },
  });
  return blocks;
}

export type ReconOptions = LlmOptions & {
  attack: AttackData;
  labels?: LabelsFile;
  templates?: Template[];
  /** 判定ルール表（役割ごとに判定できる手法の表を渡すため。中身の条件は渡さない） */
  rules?: Rule[];
  /** カルテ由来の追加の禁止語（社名、製品名など。抽象化で落ちているはずだが二重に検査する） */
  extraBannedTerms?: string[];
  maxPaths?: number;
};

export type DiscardedCandidate = {
  titleJa?: string;
  stage: "safety" | "schema" | "validation";
  reasons: string[];
  /** 破棄した候補（記録用。役割と手法 ID だけ残し、理由文は破棄した行を除く） */
  steps: { role: string; technique: string }[];
};

export type ReconResult = {
  /** 安全検査とスキーマ検証を通った候補（engine の 4 点検証はまだ） */
  candidates: AiPathCandidate[];
  discarded: DiscardedCandidate[];
  raw: unknown;
  model: string;
  /** Claude に渡した抽象化カルテの文章（記録用） */
  input: string;
  usage: { input_tokens: number; output_tokens: number };
};

/** 1 本の候補を安全検査とスキーマで篩う。通らない行が 1 つでもあれば候補ごと破棄 */
export function screenCandidate(
  raw: RawPaths["paths"][number],
  extraBannedTerms: readonly string[] = [],
): { ok: true; candidate: AiPathCandidate } | { ok: false; discarded: DiscardedCandidate } {
  const steps = raw.steps.map((s) => ({ role: s.role, technique: s.technique }));
  const reasons: string[] = [];
  const title = checkLineAgainst(raw.titleJa, extraBannedTerms);
  if (!title.ok) reasons.push(`題：${title.reasonJa}`);
  raw.steps.forEach((s, i) => {
    const r = checkLineAgainst(s.reasonJa, extraBannedTerms);
    if (!r.ok) reasons.push(`段階 ${i + 1}：${r.reasonJa}`);
  });
  if (reasons.length > 0)
    return { ok: false, discarded: { titleJa: raw.titleJa, stage: "safety", reasons, steps } };
  const parsed = AiPathCandidateSchema.safeParse({
    titleJa: raw.titleJa.slice(0, 60),
    steps: raw.steps,
  });
  if (!parsed.success)
    return {
      ok: false,
      discarded: {
        titleJa: raw.titleJa,
        stage: "schema",
        reasons: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
        steps,
      },
    };
  return { ok: true, candidate: parsed.data };
}

/** Claude に下見させる。戻り値は候補（安全検査・スキーマ検証済み）と破棄の理由 */
export async function reconnoiter(
  abstracted: AbstractedProfile,
  options: ReconOptions,
): Promise<ReconResult> {
  const input = renderAbstracted(abstracted);
  const max = Math.min(MAX_PATHS, Math.max(1, Math.floor(options.maxPaths ?? 3)));
  const user = `${input}\n\n上の構成について、型紙以外の入口から目標の役割に至る侵入経路の候補を最大 ${max} 本、スキーマに従って JSON だけで出力してください。`;
  const r = await callStructured<RawPaths>(
    { ...options, maxTokens: options.maxTokens ?? 4000 },
    {
      system: buildAttackerSystem(options.attack, {
        ...(options.labels ? { labels: options.labels } : {}),
        ...(options.templates ? { templates: options.templates } : {}),
        ...(options.rules ? { rules: options.rules } : {}),
      }),
      user,
      schema: aiPathsJsonSchema,
      parse: (v) => RawPaths.parse(v),
    },
  );
  const candidates: AiPathCandidate[] = [];
  const discarded: DiscardedCandidate[] = [];
  for (const p of r.value.paths.slice(0, max)) {
    const s = screenCandidate(p, options.extraBannedTerms ?? []);
    if (s.ok) candidates.push(s.candidate);
    else discarded.push(s.discarded);
  }
  return {
    candidates,
    discarded,
    raw: r.raw,
    model: r.model,
    input,
    usage: { input_tokens: r.usage.input_tokens, output_tokens: r.usage.output_tokens },
  };
}

/** カルテから、抽象化後にも混ざってはいけない語を集める（社名、製品名、バージョン、ホスト名、ドメイン） */
export function profileBannedTerms(profile: CompanyProfile): string[] {
  const out = new Set<string>();
  const add = (v: unknown) => {
    if (typeof v === "string" && v.trim().length >= 3) out.add(v.trim());
  };
  add(profile.companyName);
  add(profile.domain);
  add(profile.vendor?.name);
  add(profile.vendor?.email);
  for (const a of profile.assets) {
    add(a.product);
    add(a.version);
    for (const [k, v] of Object.entries(a.attrs))
      if (typeof v === "string" && ["hostname", "cve", "product", "version"].includes(k)) add(v);
  }
  return [...out];
}

export type ValidatedRecon = {
  paths: AttackPath[];
  discarded: DiscardedCandidate[];
  /** 候補ごとの検証結果（記録用） */
  validations: { titleJa?: string; result: AiPathValidation }[];
};

/** engine の 4 点検証に通す。通った経路は source: ai の AttackPath */
export function validateCandidates(
  candidates: AiPathCandidate[],
  graph: Graph,
  profile: CompanyProfile,
  knowledge: Knowledge,
  idPrefix = "ai",
  options: ValidateAiPathOptions = {},
): ValidatedRecon {
  const paths: AttackPath[] = [];
  const discarded: DiscardedCandidate[] = [];
  const validations: ValidatedRecon["validations"] = [];
  candidates.forEach((c, i) => {
    const result = validateAiPath(c, graph, profile, knowledge, `${idPrefix}-${i + 1}`, options);
    validations.push({ ...(c.titleJa ? { titleJa: c.titleJa } : {}), result });
    if (result.ok) {
      paths.push(result.path);
    } else {
      discarded.push({
        ...(c.titleJa ? { titleJa: c.titleJa } : {}),
        stage: "validation",
        reasons: result.reasons,
        steps: c.steps.map((s) => ({ role: s.role, technique: s.technique })),
      });
    }
  });
  return { paths, discarded, validations };
}

const STATE_JA: Record<string, string> = {
  blocked: "止まる",
  recoverable: "復旧できる",
  unknown: "未確認",
  human: "人次第",
  breached: "突破される",
};

/**
 * ターミナル風に流す行（短い行だけ。手法 ID と役割 ID、検証の結果）。
 * 実行時も記録の再生時も、このデータから同じ行を組み立てる
 */
export function buildReconLog(args: {
  abstracted: AbstractedProfile;
  attackVersion: string;
  candidates: AiPathCandidate[];
  validated: ValidatedRecon;
  screened: DiscardedCandidate[];
  recorded: boolean;
  model?: string;
  techniqueLabel?: (id: string) => string | undefined;
}): string[] {
  const tl = (id: string) => {
    const l = args.techniqueLabel?.(id);
    return l ? `${id} ${l}` : id;
  };
  const log: string[] = [];
  log.push(
    args.recorded
      ? "記録した下見を再生（作り物の台本ではなく、実際の出力の記録）"
      : `下見を開始${args.model ? `（${args.model}）` : ""}`,
  );
  log.push(
    `カルテを役割の枠に抽象化：役割 ${args.abstracted.roles.length - 1} 件、固有名詞なし、目標 ${args.abstracted.goals.join("・")}`,
  );
  log.push(`ATT&CK v${args.attackVersion} の手法一覧（${RECON_TACTICS.length} 戦術）を参照`);
  const total = args.candidates.length + args.screened.length;
  log.push(`候補 ${total} 本を受け取った`);
  for (const d of args.screened) {
    log.push(`候補「${d.titleJa ?? "（無題）"}」… 安全検査で破棄：${d.reasons[0] ?? ""}`);
  }
  args.validated.validations.forEach((v, i) => {
    const c = args.candidates[i];
    if (!c) return;
    const chain = c.steps.map((s) => `${s.role} ${tl(s.technique)}`).join(" → ");
    log.push(`候補 ${i + 1}「${c.titleJa ?? "（無題）"}」：${chain}`);
    if (v.result.ok) {
      const states = v.result.path.steps.map((s) => `${s.role}=${STATE_JA[s.state] ?? s.state}`);
      log.push(`検証：手法 ID ✓ 役割 ✓ つながり ✓ 判定ルール ✓ → 採用（${states.join("、")}）`);
    } else {
      log.push(`検証：破棄（${v.result.reasons.join("；")}）`);
    }
  });
  const open = args.validated.paths.filter((p) => p.reachedCore).length;
  log.push(
    `結果：採用 ${args.validated.paths.length} 本（うち中核に到達 ${open} 本）、破棄 ${args.screened.length + args.validated.discarded.length} 本`,
  );
  return log;
}
