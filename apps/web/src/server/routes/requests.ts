/**
 * 確認依頼と回答の API。
 * - POST /            依頼を作り、依頼文を生成し、送信箱に積む（SMTP_URL があれば送る）
 * - GET  /            送信箱（依頼と回答の状態）
 * - GET  /events      SSE。回答が来たら answer イベントで AnswerInput を流す
 * - GET  /:token      回答ページ用：質問と選択肢
 * - POST /:token/answer  回答を保存し、AnswerInput に変換して返す（二重回答は 409）
 * - POST /measure-draft  対策依頼文の下書き（保存も送信もしない）
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadKnowledge } from "@uchidai/engine";
import { type WriterOptions, writeMeasureRequest, writeVendorRequest } from "@uchidai/llm";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import {
  type AnswerPageView,
  AnswerRequest,
  CreateRequest,
  MeasureDraftRequest,
  type MeasureDraftView,
} from "../../shared/requests.ts";
import { type Mailer, mailerFromEnv, mailtoUrl } from "../mail/mailer.ts";
import { backgroundFor, questionFor } from "../requests/questions.ts";
import {
  AlreadyAnsweredError,
  newId,
  newToken,
  RequestStore,
  type StoredRequest,
  TOKEN_PATTERN,
  toView,
  UnknownChoiceError,
} from "../store/requests.ts";

export type RequestDeps = {
  store: RequestStore;
  mailer: Mailer;
  /** 回答リンクの土台（PUBLIC_BASE_URL。Cloudflare Tunnel の URL など） */
  publicBaseUrl: string;
  /** SSE の keepalive 間隔 */
  keepAliveMs?: number;
  /** SSE の同時接続の上限（超えたら 503） */
  maxSubscribers?: number;
  /** 保存する依頼の件数の上限（超えたら 429） */
  maxRequests?: number;
  writer?: WriterOptions;
  now?: () => Date;
};

export const DEFAULT_MAX_SUBSCRIBERS = 32;
export const DEFAULT_MAX_REQUESTS = 1000;

export const defaultStoreFile = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  ".data",
  "requests.json",
);

/** 環境変数から既定の依存を組む */
export function depsFromEnv(env: NodeJS.ProcessEnv = process.env): RequestDeps {
  return {
    store: new RequestStore({ file: env.UCHIDAI_REQUESTS_FILE ?? defaultStoreFile }),
    mailer: mailerFromEnv(env),
    publicBaseUrl: (env.PUBLIC_BASE_URL ?? "http://localhost:5173").replace(/\/+$/, ""),
  };
}

const JA_DATE = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "long",
  day: "numeric",
});
export function defaultDeadline(now: Date, days = 7): string {
  return JA_DATE.format(new Date(now.getTime() + days * 86_400_000));
}

export function requestRoutes(deps: RequestDeps = depsFromEnv()): Hono {
  const { store, mailer } = deps;
  const publicBaseUrl = deps.publicBaseUrl.replace(/\/+$/, "");
  const now = deps.now ?? (() => new Date());
  const keepAliveMs = deps.keepAliveMs ?? 15_000;
  const maxSubscribers = deps.maxSubscribers ?? DEFAULT_MAX_SUBSCRIBERS;
  const maxRequests = deps.maxRequests ?? DEFAULT_MAX_REQUESTS;
  const r = new Hono();

  r.get("/", (c) => c.json({ items: store.list().map(toView) }));

  r.get("/events", (c) => {
    if (store.subscriberCount >= maxSubscribers)
      return c.json(
        { error: "回答の待ち受けの接続が多すぎます。他のタブを閉じてから開き直してください" },
        503,
      );
    return streamSSE(c, async (stream) => {
      let open = true;
      const unsub = store.subscribe((ev) => {
        void stream.writeSSE({ event: "answer", data: JSON.stringify(ev), id: ev.requestId });
      });
      stream.onAbort(() => {
        open = false;
        unsub();
      });
      await stream.writeSSE({ event: "ready", data: JSON.stringify({ at: now().toISOString() }) });
      while (open) {
        await stream.sleep(keepAliveMs);
        if (open) await stream.writeSSE({ event: "ping", data: "" });
      }
    });
  });

  r.post("/", async (c) => {
    const body = CreateRequest.parse(await c.req.json());
    if (store.size >= maxRequests)
      return c.json(
        { error: `依頼の保存が上限（${maxRequests} 件）に達しました。古い依頼を整理してください` },
        429,
      );
    const k = loadKnowledge();
    const asset = body.profile.assets.find((a) => a.id === body.assetId);
    if (!asset) return c.json({ error: `資産 ${body.assetId} がカルテにありません` }, 404);
    const q = questionFor(body.mitigation);
    if (!q) return c.json({ error: `緩和策 ${body.mitigation} の質問はまだありません` }, 404);
    const bg = backgroundFor(body.mitigation, asset.role, k);
    const roleLabel = k.roles.find((x) => x.id === asset.role)?.labelJa ?? asset.role;
    const token = newToken();
    const answerUrl = `${publicBaseUrl}/#/answer/${token}`;
    const deadline = body.deadline ?? defaultDeadline(now());
    const mail = await writeVendorRequest(
      {
        companyLabel: body.profile.companyName,
        vendorLabel: body.profile.vendor?.name,
        assetLabel: asset.label,
        assetRoleLabel: roleLabel,
        question: q.textJa,
        choices: q.choices.map((x) => x.labelJa),
        mitigationId: bg.mitigationId,
        mitigationLabel: bg.mitigationLabelJa,
        techniqueId: bg.techniqueId,
        techniqueLabel: bg.techniqueLabelJa,
        materialsJa: bg.materialsJa,
        deadline,
        answerUrl,
      },
      { ...(deps.writer ?? {}), ...(body.writer ? { writer: body.writer } : {}) },
    );
    const to = body.to ?? body.profile.vendor?.email;
    const sent = await mailer.send({ to, subject: mail.subject, text: mail.text });
    const { ruleId: _rule, ...background } = bg;
    const item: StoredRequest = {
      id: newId(),
      token,
      ...(body.profile.id ? { profileId: body.profile.id } : {}),
      companyLabel: body.profile.companyName,
      assetId: asset.id,
      assetLabel: asset.label,
      mitigation: body.mitigation,
      background,
      question: {
        textJa: q.textJa,
        ...(q.hintJa ? { hintJa: q.hintJa } : {}),
        choices: q.choices.map((x) => ({ id: x.id, labelJa: x.labelJa })),
      },
      ...(to ? { to } : {}),
      subject: mail.subject,
      text: mail.text,
      answerUrl,
      mailtoUrl: sent.mailtoUrl,
      createdAt: now().toISOString(),
      sentVia: sent.via,
      ...(sent.sentAt ? { sentAt: sent.sentAt } : {}),
      ...(sent.error ? { sendError: sent.error } : {}),
      writer: mail.writer,
      choiceMap: q.choices,
    };
    store.add(item);
    return c.json(
      {
        request: toView(item),
        ...(mail.fallbackReasonJa ? { writerNoteJa: mail.fallbackReasonJa } : {}),
      },
      201,
    );
  });

  r.post("/measure-draft", async (c) => {
    const body = MeasureDraftRequest.parse(await c.req.json());
    const k = loadKnowledge();
    const measure = k.measures.find((m) => m.id === body.measureId);
    if (!measure) return c.json({ error: `対策 ${body.measureId} はありません` }, 404);
    const roles = new Set(measure.patches.map((p) => p.role));
    const asset = body.assetId
      ? body.profile.assets.find((a) => a.id === body.assetId)
      : body.profile.assets.find((a) => roles.has(a.role));
    if (!asset) return c.json({ error: "対策の対象となる資産がカルテにありません" }, 404);
    const bg = backgroundFor(measure.mitigation, asset.role, k);
    const roleLabel = k.roles.find((x) => x.id === asset.role)?.labelJa ?? asset.role;
    const mail = await writeMeasureRequest(
      {
        companyLabel: body.profile.companyName,
        vendorLabel: body.profile.vendor?.name,
        assetLabel: asset.label,
        assetRoleLabel: roleLabel,
        measureLabel: measure.labelJa,
        mitigationId: bg.mitigationId,
        mitigationLabel: bg.mitigationLabelJa,
        techniqueId: bg.techniqueId,
        techniqueLabel: bg.techniqueLabelJa,
        costJa: measure.costSourceJa,
        deadline: body.deadline ?? defaultDeadline(now(), 30),
      },
      { ...(deps.writer ?? {}), ...(body.writer ? { writer: body.writer } : {}) },
    );
    const to = body.profile.vendor?.email;
    const view: MeasureDraftView = {
      ...(to ? { to } : {}),
      subject: mail.subject,
      text: mail.text,
      mailtoUrl: mailtoUrl({ to, subject: mail.subject, text: mail.text }),
      writer: mail.writer,
    };
    return c.json(view);
  });

  r.get("/:token", (c) => {
    const token = c.req.param("token");
    if (!TOKEN_PATTERN.test(token))
      return c.json({ error: "回答リンクの形式が正しくありません" }, 400);
    const it = store.byToken(token);
    if (!it)
      return c.json(
        { error: "この回答リンクは見つかりません（期限切れか、誤った URL です）" },
        404,
      );
    const view: AnswerPageView = {
      companyLabel: it.companyLabel,
      assetLabel: it.assetLabel,
      question: it.question,
      background: it.background,
      createdAt: it.createdAt,
      answered: Boolean(it.answer),
      ...(it.answeredAt ? { answeredAt: it.answeredAt } : {}),
    };
    return c.json(view);
  });

  r.post("/:token/answer", async (c) => {
    const token = c.req.param("token");
    if (!TOKEN_PATTERN.test(token))
      return c.json({ error: "回答リンクの形式が正しくありません" }, 400);
    const body = AnswerRequest.parse(await c.req.json());
    try {
      const ev = store.answer(token, body);
      if (!ev) return c.json({ error: "この回答リンクは見つかりません" }, 404);
      return c.json({ ok: true, answer: ev.answer, choiceLabelJa: ev.choiceLabelJa });
    } catch (e) {
      if (e instanceof AlreadyAnsweredError) return c.json({ error: e.message }, 409);
      if (e instanceof UnknownChoiceError) return c.json({ error: e.message }, 400);
      throw e;
    }
  });

  return r;
}
