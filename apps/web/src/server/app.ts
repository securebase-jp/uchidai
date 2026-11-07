/**
 * API（Hono）。Claude API はここからだけ呼び、キーはブラウザに渡さない。
 * 判定はすべて @uchidai/engine（決定的）。Claude は記事を読むだけ。
 *
 * 守り：入力は zod で検証し、本文の大きさに上限を置く。公開 URL 経由の要求は回答ページの API だけに絞る。
 * 記事の URL は公開された http(s) だけ（手元や社内のアドレスには向けない）。エラー応答にスタックや内部パスは出さない。
 */
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildGraph,
  Case,
  CompanyProfile,
  effectiveMeasures,
  evaluate,
  loadKnowledge,
  measureCost,
  ProfileAnswers,
  profileFromAnswers,
  repoRoot,
  sourcesView,
} from "@uchidai/engine";
import { type ReadKnowledge, readCase, templateTechniques, verifyCase } from "@uchidai/llm";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { Answers, MAX_PDF_BASE64_CHARS, MeasureIds, ReadRequest } from "../shared/api.ts";
import { isThinReading, loadArticle, thinBodyError } from "./article-source.ts";
import { ClientError, logError, publicMessage, zodErrorBody } from "./errors.ts";
import { hostGuard } from "./host-guard.ts";
import { loadQuestions } from "./knowledge-view.ts";
import { RateLimitError, takeClaudeSlot } from "./limits.ts";
import { patchProfile } from "./profile-patch.ts";
import { remoteGuard } from "./remote-guard.ts";
import { allQuestions } from "./requests/questions.ts";
import { attackerRoutes } from "./routes/attacker.ts";
import { demoRoutes } from "./routes/demo.ts";
import { kevRoutes } from "./routes/kev.ts";
import { onepagerRoutes } from "./routes/onepager.ts";
import { reconRoutes } from "./routes/recon.ts";
import { requestRoutes } from "./routes/requests.ts";
import { sameOriginGuard } from "./same-origin.ts";
import { readSeries } from "./series-read.ts";
import { SeriesFetchError, type SeriesPaste } from "./series-source.ts";

const SafeId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);

/** 本文の上限：記事の読解（PDF の base64 を含む）だけ大きく、他は 2MB */
const READ_BODY_LIMIT = MAX_PDF_BASE64_CHARS + 64 * 1024;
const DEFAULT_BODY_LIMIT = 2 * 1024 * 1024;

/**
 * CORS：手元の localhost だけ。画面と API は同じ origin（Vite のプロキシ、本番の配信）で動くので、公開 URL（トンネル）で
 * 画面を開く場合も同じ origin の呼び出しになり、CORS の許可は要らない
 */
export function corsOrigin(origin: string): string | null {
  if (!origin) return null;
  if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin)) return origin;
  return null;
}

export const app = new Hono();
app.use("/api/*", cors({ origin: (o) => corsOrigin(o) }));
app.use("/api/*", remoteGuard());
// Host が手元の名前でなければ 421（DNS の付け替え対策。SEC-003）
app.use("/api/*", hostGuard());
// 他サイトのページからの要求を断る（SEC-002）。SSE は開きっぱなしの接続を他サイトから作れないよう GET でも見る（SEC-012）
app.use(
  "/api/*",
  sameOriginGuard({ allowOrigin: corsOrigin, guardedGetPaths: ["/api/requests/events"] }),
);
app.use("/api/*", async (c, next) => {
  const max = c.req.path === "/api/case/read" ? READ_BODY_LIMIT : DEFAULT_BODY_LIMIT;
  return bodyLimit({
    maxSize: max,
    onError: (ctx) => ctx.json({ error: "送信されたデータが大きすぎます" }, 413),
  })(c, next);
});

app.onError((err, c) => {
  if (err instanceof HTTPException) return err.getResponse();
  if (err instanceof SeriesFetchError)
    return c.json({ error: err.message, failures: err.failures }, err.status);
  if (err instanceof RateLimitError)
    return c.json({ error: err.message }, 429, { "retry-after": String(err.retryAfterSec) });
  if (err instanceof ClientError)
    return c.json(
      { error: err.message, ...(err.reason ? { reason: err.reason } : {}) },
      err.status,
    );
  if (err instanceof z.ZodError) return c.json(zodErrorBody(err), 400);
  if (err instanceof SyntaxError)
    return c.json({ error: "入力の形式が正しくありません（JSON として読めません）" }, 400);
  logError(`[api] ${c.req.method} ${c.req.path}:`, err);
  return c.json({ error: publicMessage(err) }, 500);
});

// readAvailable：記事の読解（Claude）が使えるか。キーの値は返さない
app.get("/api/health", (c) =>
  c.json({ ok: true, readAvailable: Boolean(process.env.ANTHROPIC_API_KEY) }),
);
app.route("/api/attacker", attackerRoutes);

// 外部確認（所有確認 → DNS・証明書の公開ログ → カルテへの反映）。P2：src/server/routes/recon.ts
app.route("/api/recon", reconRoutes());

// 悪用確認済み脆弱性（CISA KEV）の取得・キャッシュ・突き合わせ。P8：src/server/routes/kev.ts
app.route("/api/kev", kevRoutes());

// 確認依頼と回答（送信箱、回答ページ、SSE）。S7：src/server/routes/requests.ts
app.route("/api/requests", requestRoutes());

// 社長向けの一枚（S8）とデモ用の音声（S8）
app.route("/", onepagerRoutes);
app.route("/", demoRoutes);

// 出典の一覧（knowledge/sources.yaml。ATT&CK の版は version.json から差し込む）。会社カルテや判定は読まない読み取り専用
app.get("/api/sources", (c) => c.json(sourcesView()));

// 知識：ラベル、対策ボタン、5問、緩和策ごとの確認の質問表（カルテ画面と確認依頼で共有）、業種別パターン、役割、ATT&CK のバージョン
app.get("/api/knowledge", (c) => {
  const k = loadKnowledge();
  return c.json({
    attackVersion: k.attack.version,
    labels: k.labels,
    measures: k.measures,
    questions: loadQuestions(),
    controlQuestions: allQuestions(),
    patterns: k.patterns,
    roles: k.roles,
    entryCandidates: k.entryCandidates,
    templates: k.templates.map((t) => ({
      id: t.id,
      damageType: t.damageType,
      labelJa: t.labelJa,
      descriptionJa: t.descriptionJa,
      stages: t.stages.map((s) => ({ id: s.id, labelJa: s.labelJa })),
    })),
  });
});

// 5問の回答 → 会社カルテと構成グラフ
const FromAnswers = z.object({
  answers: ProfileAnswers,
  companyName: z.string().max(80).optional(),
  /** 同じ会社のカルテを作り直すとき（リセットなど）に前の ID を渡す。無ければ新しい会社として新しい ID を付ける */
  profileId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/)
    .optional(),
});
app.post("/api/profile/from-answers", async (c) => {
  const body = FromAnswers.parse(await c.req.json());
  const k = loadKnowledge();
  const profile = profileFromAnswers(
    body.answers,
    k.patterns,
    body.companyName,
    k.sites,
    body.profileId ?? `from-answers-${randomUUID().slice(0, 8)}`,
  );
  return c.json({ profile, graph: buildGraph(profile, k.roles) });
});

// 架空企業のカルテ（examples/）
/** 一覧の 1 件。会社名と業種（構成パターンの名前）、人数だけを返す（カルテの中身は :id で） */
export type ExampleSummary = {
  id: string;
  companyName: string;
  patternLabelJa: string;
  employees?: number;
  fictional: boolean;
};
/** examples/*.json のうち、ID が安全で CompanyProfile として検証できるものだけを一覧にする */
export function listExamples(): ExampleSummary[] {
  const dir = join(repoRoot, "examples");
  if (!existsSync(dir)) return [];
  const patterns = loadKnowledge().patterns;
  const out: ExampleSummary[] = [];
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()) {
    const id = SafeId.safeParse(file.slice(0, -".json".length));
    if (!id.success) continue;
    try {
      const profile = CompanyProfile.parse(JSON.parse(readFileSync(join(dir, file), "utf8")));
      out.push({
        id: id.data,
        companyName: profile.companyName,
        patternLabelJa: patterns.find((p) => p.id === profile.pattern)?.labelJa ?? profile.pattern,
        ...(profile.employees !== undefined ? { employees: profile.employees } : {}),
        fictional: profile.fictional,
      });
    } catch {
      // 検証できないファイルは一覧に出さない（画面から選べる会社は読めるものだけ）
    }
  }
  return out;
}
app.get("/api/examples", (c) => c.json({ items: listExamples() }));
app.get("/api/examples/:id", (c) => {
  const id = SafeId.parse(c.req.param("id"));
  const path = join(repoRoot, "examples", `${id}.json`);
  if (!existsSync(path)) return c.json({ error: `カルテ ${id} はありません` }, 404);
  const profile = CompanyProfile.parse(JSON.parse(readFileSync(path, "utf8")));
  return c.json({ profile, graph: buildGraph(profile, loadKnowledge().roles) });
});

// 記録済みの読解結果（デモとキー無しの動作確認用）
const RecordingFile = z.object({
  caseId: z.string(),
  recordedAt: z.string().optional(),
  model: z.string().optional(),
  note: z.string().optional(),
  attackVersion: z.string().optional(),
  output: Case,
});
app.get("/api/case/recorded", (c) => {
  const dir = join(repoRoot, "eval", "recordings");
  const ids = ["ipa-case-1", "ipa-case-2", "ipa-case-3", "ipa-case-4", "ipa-case-5"].filter((id) =>
    existsSync(join(dir, `${id}.with-knowledge.json`)),
  );
  const items = ids.map((id) => {
    const rec = RecordingFile.parse(
      JSON.parse(readFileSync(join(dir, `${id}.with-knowledge.json`), "utf8")),
    );
    return { caseId: id, title: rec.output.title, damageType: rec.output.damageType };
  });
  return c.json({ items });
});
app.get("/api/case/recorded/:caseId", (c) => {
  const id = SafeId.parse(c.req.param("caseId"));
  const path = join(repoRoot, "eval", "recordings", `${id}.with-knowledge.json`);
  if (!existsSync(path)) return c.json({ error: `記録 ${id} はありません` }, 404);
  const rec = RecordingFile.parse(JSON.parse(readFileSync(path, "utf8")));
  return c.json({
    case: rec.output,
    meta: {
      caseId: rec.caseId,
      recordedAt: rec.recordedAt,
      model: rec.model,
      note: rec.note,
      attackVersion: rec.attackVersion,
    },
  });
});

/** 同じ事故の複数の公表を 1 件として読んだ応答（単一の記事の応答と同じ形に、series を足す） */
async function readSeriesResponse(
  urls: string[],
  onError: "fail" | "skip",
  pastes: SeriesPaste[] = [],
) {
  const { merged, loaded, series } = await readSeries(urls, onError, {}, pastes);
  const first = loaded.parts[0];
  const incomplete = [...new Set(loaded.parts.flatMap((p) => p.incomplete ?? []))];
  return {
    case: merged.verified.case,
    report: merged.verified.report,
    article: {
      title: first?.title,
      kind: first?.kind,
      sourceUrl: first?.url,
      chars: loaded.text.length,
      ...(incomplete.length > 0 ? { incomplete } : {}),
      ...(loaded.parts.some((p) => p.truncated) ? { truncated: true } : {}),
    },
    model: merged.read.model,
    ...(series ? { series } : loaded.failures.length > 0 ? { failures: loaded.failures } : {}),
  };
}

// 記事を読む（Claude API。キーが無ければ 503）
app.post("/api/case/read", async (c) => {
  const { input } = ReadRequest.parse(await c.req.json());
  if (!process.env.ANTHROPIC_API_KEY) {
    return c.json(
      {
        error:
          "記事の読解には Claude API のキーが必要です。サーバの環境変数 ANTHROPIC_API_KEY を設定してください。キー無しでは「記録済みの事例」から選べます。",
      },
      503,
    );
  }
  // 1 分あたりの読解の回数（SEC-006）。urls の複数の読解も 1 回と数える
  takeClaudeSlot("read");
  if (input.kind === "urls")
    return c.json(await readSeriesResponse(input.urls, input.onError, input.pastes));
  const article = await loadArticle(input);
  const k = loadKnowledge();
  const knowledge: ReadKnowledge = { labels: k.labels, templates: k.templates };
  const meta: { url?: string; title?: string } = {};
  if (article.sourceUrl) meta.url = article.sourceUrl;
  if (article.title) meta.title = article.title;
  const read = await readCase(article.text, { attack: k.attack, knowledge, ...meta });
  const verifyOpts: Parameters<typeof verifyCase>[3] = {};
  if (meta.url) verifyOpts.url = meta.url;
  if (meta.title) verifyOpts.title = meta.title;
  const allowed = templateTechniques(k.templates, read.value.damageType);
  if (allowed.size > 0) verifyOpts.allowedTechniques = allowed;
  const verified = verifyCase(read.raw, article.text, k.attack, verifyOpts);
  // 保険（TRIAL-I-002）：短い本文を読んで「対象外・段階なし」になったときは、判定した顔をせず、取り直す案内にする。貼り付けの短い文は対象外
  if (input.kind !== "text" && isThinReading(verified.case, article.text.length))
    throw thinBodyError(article.text.replace(/\s+/g, "").length);
  return c.json({
    case: verified.case,
    report: verified.report,
    article: {
      title: article.title,
      kind: article.kind,
      sourceUrl: article.sourceUrl,
      chars: article.text.length,
      ...(article.incomplete ? { incomplete: article.incomplete } : {}),
      ...(article.truncated ? { truncated: true } : {}),
    },
    model: read.model,
  });
});

// 判定（対策ボタンと回答を適用してから）
const EvaluateRequest = z.object({
  case: Case,
  profile: CompanyProfile,
  measureIds: MeasureIds,
  answers: Answers,
});
app.post("/api/evaluate", async (c) => {
  const body = EvaluateRequest.parse(await c.req.json());
  const k = loadKnowledge();
  const { profile, measures } = patchProfile(body.profile, body.measureIds, body.answers, k);
  const graph = buildGraph(profile, k.roles);
  const verdict = evaluate(body.case, profile, { knowledge: k, graph });
  const measureCosts = Object.fromEntries(
    k.measures.map((m) => {
      const { costJa, costSourceJa } = measureCost(m, profile, k);
      return [m.id, { costJa, ...(costSourceJa ? { costSourceJa } : {}) }];
    }),
  );
  // 次の一手：いまの経路で効く対策を早い段階から 3 つ（engine の規則。既に講じた対策は除く）
  const nextMoves = effectiveMeasures(verdict, k.measures, profile)
    // 助言だけの対策（委託先管理など。patches が空）は、押しても判定が変わらないのでボタンにしない
    .filter(({ measure }) => measure.patches.length > 0)
    .slice(0, 3)
    .map(({ measure, stageJa }) => ({ measureId: measure.id, ...(stageJa ? { stageJa } : {}) }));
  return c.json({ graph, verdict, measures, profile, measureCosts, nextMoves });
});
