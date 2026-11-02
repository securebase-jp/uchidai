/**
 * API（Hono）。Claude API はここからだけ呼び、キーはブラウザに渡さない。
 * 判定はすべて @uchidai/engine（決定的）。Claude は記事を読むだけ。
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  applyAnswer,
  applyMeasures,
  buildGraph,
  Case,
  CompanyProfile,
  evaluate,
  loadKnowledge,
  type MeasureDef,
  measureCost,
  ProfileAnswers,
  profileFromAnswers,
  repoRoot,
} from "@uchidai/engine";
import {
  fetchArticle,
  type ReadKnowledge,
  readCase,
  templateTechniques,
  verifyCase,
} from "@uchidai/llm";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { AnswerInput, ReadRequest } from "../shared/api.ts";
import { loadQuestions } from "./knowledge-view.ts";
import { demoRoutes } from "./routes/demo.ts";
import { onepagerRoutes } from "./routes/onepager.ts";

const SafeId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);

export const app = new Hono();
app.use("/api/*", cors());

app.onError((err, c) => {
  if (err instanceof z.ZodError) {
    return c.json({ error: "入力の形式が正しくありません", details: err.issues }, 400);
  }
  console.error(err);
  return c.json(
    { error: err instanceof Error ? err.message : "サーバ側でエラーが起きました" },
    500,
  );
});

app.get("/api/health", (c) => c.json({ ok: true }));
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
  if (!process.env.ANTHROPIC_API_KEY) {
    return c.json(
      {
        error:
          "記事の読解には Claude API のキーが必要です。サーバの環境変数 ANTHROPIC_API_KEY を設定してください。キー無しでは「記録済みの事例」から選べます。",
      },
      503,
    );
  }
  const { input } = ReadRequest.parse(await c.req.json());
  const article =
    input.kind === "url"
      ? await fetchArticle({
          kind: "url",
          url: input.url,
          ...(input.pages ? { pages: input.pages } : {}),
        })
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
  measureIds: z.array(z.string()).default([]),
  answers: z.array(AnswerInput).default([]),
});
app.post("/api/evaluate", async (c) => {
  const body = EvaluateRequest.parse(await c.req.json());
  const k = loadKnowledge();
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
