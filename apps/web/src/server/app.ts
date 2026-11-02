/**
 * API（Hono）。Claude API はここからだけ呼び、キーはブラウザに渡さない。
 * 判定はすべて @uchidai/engine（決定的）。Claude は記事を読むだけ。
 *
 * 守り：入力は zod で検証し、本文の大きさに上限を置く。公開 URL 経由の要求は回答ページの API だけに絞る。
 * 記事の URL は公開された http(s) だけ（手元や社内のアドレスには向けない）。エラー応答にスタックや内部パスは出さない。
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildGraph,
  Case,
  CompanyProfile,
  evaluate,
  loadKnowledge,
  measureCost,
  ProfileAnswers,
  profileFromAnswers,
  repoRoot,
} from "@uchidai/engine";
import {
  fetchArticle,
  type ReadKnowledge,
  readCase,
  resolveFetch,
  templateTechniques,
  verifyCase,
} from "@uchidai/llm";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { Answers, MAX_PDF_BASE64_CHARS, MeasureIds, ReadRequest } from "../shared/api.ts";
import { ClientError, publicMessage } from "./errors.ts";
import { loadQuestions } from "./knowledge-view.ts";
import { patchProfile } from "./profile-patch.ts";
import { remoteGuard } from "./remote-guard.ts";
import { attackerRoutes } from "./routes/attacker.ts";
import { demoRoutes } from "./routes/demo.ts";
import { onepagerRoutes } from "./routes/onepager.ts";
import { requestRoutes } from "./routes/requests.ts";
import { assertPublicUrl, guardedFetch } from "./safe-url.ts";

const SafeId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);

/** 本文の上限：記事の読解（PDF の base64 を含む）だけ大きく、他は 2MB */
const READ_BODY_LIMIT = MAX_PDF_BASE64_CHARS + 64 * 1024;
const DEFAULT_BODY_LIMIT = 2 * 1024 * 1024;

/** CORS：同じ origin（Vite のプロキシ、本番の配信）か、手元の localhost と PUBLIC_BASE_URL だけ */
export function corsOrigin(origin: string, env: NodeJS.ProcessEnv = process.env): string | null {
  if (!origin) return null;
  if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin)) return origin;
  const pub = env.PUBLIC_BASE_URL;
  if (pub) {
    try {
      if (new URL(pub).origin === origin) return origin;
    } catch {
      // PUBLIC_BASE_URL が URL でなければ無視
    }
  }
  return null;
}

export const app = new Hono();
app.use("/api/*", cors({ origin: (o) => corsOrigin(o) }));
app.use("/api/*", remoteGuard());
app.use("/api/*", async (c, next) => {
  const max = c.req.path === "/api/case/read" ? READ_BODY_LIMIT : DEFAULT_BODY_LIMIT;
  return bodyLimit({
    maxSize: max,
    onError: (ctx) => ctx.json({ error: "送信されたデータが大きすぎます" }, 413),
  })(c, next);
});

app.onError((err, c) => {
  if (err instanceof HTTPException) return err.getResponse();
  if (err instanceof ClientError) return c.json({ error: err.message }, err.status);
  if (err instanceof z.ZodError) {
    const details = err.issues.slice(0, 20).map((i) => ({ path: i.path, message: i.message }));
    return c.json({ error: "入力の形式が正しくありません", details }, 400);
  }
  if (err instanceof SyntaxError)
    return c.json({ error: "入力の形式が正しくありません（JSON として読めません）" }, 400);
  console.error(`[api] ${c.req.method} ${c.req.path}:`, err);
  return c.json({ error: publicMessage(err) }, 500);
});

app.get("/api/health", (c) => c.json({ ok: true }));
app.route("/api/attacker", attackerRoutes);

// 確認依頼と回答（送信箱、回答ページ、SSE）。S7：src/server/routes/requests.ts
app.route("/api/requests", requestRoutes());

// 社長向けの一枚（S8）とデモ用の音声（S8）
app.route("/", onepagerRoutes);
app.route("/", demoRoutes);

// 知識：ラベル、対策ボタン、5問、業種別パターン、役割、ATT&CK のバージョン
app.get("/api/knowledge", (c) => {
  const k = loadKnowledge();
  return c.json({
    attackVersion: k.attack.version,
    labels: k.labels,
    measures: k.measures,
    questions: loadQuestions(),
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
});
app.post("/api/profile/from-answers", async (c) => {
  const body = FromAnswers.parse(await c.req.json());
  const k = loadKnowledge();
  const profile = profileFromAnswers(body.answers, k.patterns, body.companyName);
  return c.json({ profile, graph: buildGraph(profile, k.roles) });
});

// 架空企業のカルテ（examples/）
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
  if (input.kind === "url") await assertPublicUrl(input.url);
  const article =
    input.kind === "url"
      ? await fetchArticle(
          { kind: "url", url: input.url, ...(input.pages ? { pages: input.pages } : {}) },
          { fetch: guardedFetch(resolveFetch()) },
        )
      : input.kind === "text"
        ? await fetchArticle({
            kind: "text",
            text: input.text,
            ...(input.title ? { title: input.title } : {}),
            ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}),
          })
        : await fetchArticle({
            kind: "pdf",
            data: new Uint8Array(Buffer.from(input.dataBase64, "base64")),
            ...(input.pages ? { pages: input.pages } : {}),
            ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}),
          });
  const k = loadKnowledge();
  const knowledge: ReadKnowledge = { labels: k.labels, templates: k.templates };
  const meta: { url?: string; title?: string } = {};
  if (article.sourceUrl) meta.url = article.sourceUrl;
  if (article.title) meta.title = article.title;
  const read = await readCase(article.text, { attack: k.attack, knowledge, ...meta });
  const verifyOpts: Parameters<typeof verifyCase>[3] = {};
  if (meta.url) verifyOpts.url = meta.url;
  const allowed = templateTechniques(k.templates, read.value.damageType);
  if (allowed.size > 0) verifyOpts.allowedTechniques = allowed;
  const verified = verifyCase(read.raw, article.text, k.attack, verifyOpts);
  return c.json({
    case: verified.case,
    report: verified.report,
    article: {
      title: article.title,
      kind: article.kind,
      sourceUrl: article.sourceUrl,
      chars: article.text.length,
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
  return c.json({ graph, verdict, measures, profile, measureCosts });
});
