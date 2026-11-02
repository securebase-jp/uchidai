/**
 * AI攻撃者と知見なし比較の API。
 * - POST /api/attacker/recon    下見（キーが無ければ記録を再生し recorded: true）
 * - POST /api/attacker/validate 候補を現在のカルテで 4 点検証し直す（対策ボタンの後に使う。Claude は呼ばない）
 * - POST /api/attacker/compare  知見なしの対策一覧を効く／効かない／経路の外に振り分ける（記録があれば再生）
 * Claude に渡すのは抽象化したカルテだけ。採否はすべて engine（決定的）
 */
import {
  AiPathCandidate,
  type AttackPath,
  applyAnswer,
  applyMeasures,
  buildGraph,
  Case,
  CompanyProfile,
  type Knowledge,
  loadKnowledge,
  type MeasureDef,
  terminalRoles,
  Verdict,
} from "@uchidai/engine";
import {
  type AbstractedProfile,
  abstractProfile,
  buildReconLog,
  caseAsArticle,
  compareGenericMitigations,
  type DiscardedCandidate,
  listGenericMitigations,
  loadAttackerRecording,
  loadCompareRecording,
  profileBannedTerms,
  reconnoiter,
  validateCandidates,
} from "@uchidai/llm";
import { Hono } from "hono";
import { z } from "zod";
import { AnswerInput } from "../../shared/api.ts";

export const attackerRoutes = new Hono();

const ProfileInput = z.object({
  profile: CompanyProfile,
  measureIds: z.array(z.string()).default([]),
  answers: z.array(AnswerInput).default([]),
});

/** 対策ボタンと回答を適用したカルテ（/api/evaluate と同じ手順） */
function patchedProfile(body: z.infer<typeof ProfileInput>, k: Knowledge) {
  const measures: MeasureDef[] = body.measureIds
    .map((id) => k.measures.find((m) => m.id === id))
    .filter((m): m is MeasureDef => m !== undefined);
  let profile = applyMeasures(body.profile, measures);
  for (const a of body.answers) {
    if (!profile.assets.some((x) => x.id === a.assetId)) continue;
    const { answeredAt, noteJa, attrs, ...rest } = a;
    profile = applyAnswer(profile, {
      ...rest,
      ...(answeredAt !== undefined ? { answeredAt } : {}),
      ...(noteJa !== undefined ? { noteJa } : {}),
      ...(attrs !== undefined ? { attrs } : {}),
    });
  }
  return profile;
}

/** 到達の確かな経路（未確認の段階が少ない順）を先に */
function sortPaths(paths: AttackPath[]): AttackPath[] {
  const unknowns = (p: AttackPath) =>
    p.steps.filter((s) => s.state === "unknown" || s.state === "human").length;
  return [...paths].sort(
    (a, b) => Number(b.reachedCore) - Number(a.reachedCore) || unknowns(a) - unknowns(b),
  );
}

function abstracted(profile: CompanyProfile, k: Knowledge): AbstractedProfile {
  const graph = buildGraph(profile, k.roles);
  const goals = [...terminalRoles(k)].filter((r) => r === "core");
  return abstractProfile(profile, graph, k.roles, {
    labels: k.labels,
    goals: goals.length > 0 ? goals : ["core"],
  });
}

export type ReconResponse = {
  paths: AttackPath[];
  discarded: DiscardedCandidate[];
  candidates: AiPathCandidate[];
  log: string[];
  recorded: boolean;
  meta: {
    model?: string;
    recordedAt?: string;
    note?: string;
    attempts?: number;
    attackerVersion?: string;
    /** 記録が無く、キーも無いとき */
    unavailable?: string;
  };
};

attackerRoutes.post("/recon", async (c) => {
  const body = ProfileInput.parse(await c.req.json());
  const k = loadKnowledge();
  const profile = patchedProfile(body, k);
  const graph = buildGraph(profile, k.roles);
  const abs = abstracted(profile, k);
  const techniqueLabel = (id: string) => k.labels.techniques[id];

  if (process.env.ANTHROPIC_API_KEY) {
    const r = await reconnoiter(abs, {
      attack: k.attack,
      labels: k.labels,
      templates: k.templates,
      rules: k.rules,
      extraBannedTerms: profileBannedTerms(profile),
    });
    const validated = validateCandidates(r.candidates, graph, profile, k);
    const log = buildReconLog({
      abstracted: abs,
      attackVersion: k.attack.version,
      candidates: r.candidates,
      validated,
      screened: r.discarded,
      recorded: false,
      model: r.model,
      techniqueLabel,
    });
    const res: ReconResponse = {
      paths: sortPaths(validated.paths),
      discarded: [...r.discarded, ...validated.discarded],
      candidates: r.candidates,
      log,
      recorded: false,
      meta: { model: r.model, recordedAt: new Date().toISOString() },
    };
    return c.json(res);
  }

  const rec = loadAttackerRecording(body.profile.id);
  if (!rec) {
    const res: ReconResponse = {
      paths: [],
      discarded: [],
      candidates: [],
      log: [
        "Claude API のキーが無く、このカルテの下見の記録もありません",
        "記録があるのは架空の会社（demo-seiko）だけです。サーバの環境変数 ANTHROPIC_API_KEY を設定すると実行できます",
      ],
      recorded: true,
      meta: { unavailable: "キーも記録もありません" },
    };
    return c.json(res);
  }
  const candidates = z.array(AiPathCandidate).parse(rec.candidates);
  const screened = rec.screened as DiscardedCandidate[];
  const validated = validateCandidates(candidates, graph, profile, k);
  const log = buildReconLog({
    abstracted: abs,
    attackVersion: k.attack.version,
    candidates,
    validated,
    screened,
    recorded: true,
    model: rec.model,
    techniqueLabel,
  });
  const res: ReconResponse = {
    paths: sortPaths(validated.paths),
    discarded: [...screened, ...validated.discarded],
    candidates,
    log,
    recorded: true,
    meta: {
      model: rec.model,
      recordedAt: rec.recordedAt,
      note: rec.note,
      attempts: rec.attempts,
      ...(rec.attackerVersion ? { attackerVersion: rec.attackerVersion } : {}),
    },
  };
  return c.json(res);
});

const ValidateInput = ProfileInput.extend({ candidates: z.array(AiPathCandidate).max(10) });
attackerRoutes.post("/validate", async (c) => {
  const body = ValidateInput.parse(await c.req.json());
  const k = loadKnowledge();
  const profile = patchedProfile(body, k);
  const graph = buildGraph(profile, k.roles);
  const validated = validateCandidates(body.candidates, graph, profile, k);
  return c.json({ paths: sortPaths(validated.paths), discarded: validated.discarded });
});

const CompareInput = z.object({
  caseId: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,63}$/)
    .optional(),
  case: Case.optional(),
  verdict: Verdict,
});
attackerRoutes.post("/compare", async (c) => {
  const body = CompareInput.parse(await c.req.json());
  const k = loadKnowledge();
  const rec = body.caseId ? loadCompareRecording(body.caseId) : undefined;
  if (rec) {
    return c.json({
      comparison: compareGenericMitigations(rec.items, body.verdict, k.labels),
      items: rec.items,
      recorded: true,
      meta: { model: rec.model, recordedAt: rec.recordedAt, note: rec.note },
    });
  }
  if (!process.env.ANTHROPIC_API_KEY || !body.case) {
    return c.json(
      {
        error: body.case
          ? "知見なしの比較には Claude API のキーが必要です。サーバの環境変数 ANTHROPIC_API_KEY を設定してください。キー無しでは記録済みの事例（ipa-case-1 など）で比較できます"
          : `事例 ${body.caseId ?? "（未指定）"} の記録がありません。読解済みの事例（case）を送るとキーがあれば実行できます`,
      },
      503,
    );
  }
  const r = await listGenericMitigations(caseAsArticle(body.case), {
    attack: k.attack,
    title: body.case.title,
  });
  return c.json({
    comparison: compareGenericMitigations(r.items, body.verdict, k.labels),
    items: r.items,
    recorded: false,
    meta: { model: r.model, recordedAt: new Date().toISOString() },
  });
});
