/**
 * 確認依頼と回答の API（すべて手元のサーバ専用。公開 URL 経由の要求は remote-guard が断る）。
 * ベンダーはメールの返信で番号を答え、担当者が送信箱から手で入力する。
 * - POST /            依頼を作り、依頼文を生成し、送信箱に積む（SMTP_URL があれば送る）
 * - GET  /            送信箱（依頼と回答の状態）
 * - DELETE /          送信箱を空にする
 * - GET  /events      SSE。回答の入力は answer、取り消しは retract イベントで流す（別のタブの画面を合わせる）
 * - POST /:id/reply   返信の内容（選んだ選択肢、ベンダー側の回答者名、受け取った日時、入力者）を保存し、AnswerInput に変換して返す（二重回答は 409）
 * - DELETE /:id/reply 入力した回答を取り消し、依頼を回答待ちに戻す
 * - POST /measure-draft  対策依頼文の下書き（保存も送信もしない）
 * まとめ依頼（選んだ最大 10 問を同じ宛先へ 1 通のメールにまとめる。文面はテンプレートだけで Claude は呼ばない）：
 * - POST /batch/preview   宛先と文面のプレビュー（保存も送信もしない）
 * - POST /batch           まとめ依頼を作る（親 1 ＋ 子 N を 1 回の保存で積み、メールは 1 通だけ送る）
 * - POST /batch/:id/reply 返信の入力（入力した質問の分を原子的に反映。全件成功か全件失敗）
 * - DELETE /batch/:id     まとめ依頼を消す（回答済みの子は取り消し、子もすべて削除）
 * 質問ごとの回答の取り消しは DELETE /:id/reply（子の id）
 */
import { join } from "node:path";
import { loadKnowledge } from "@uchidai/engine";
import {
  sanitizeName,
  type WriterOptions,
  writeBatchRequest,
  writeMeasureRequest,
  writeVendorRequest,
} from "@uchidai/llm";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import {
  BatchPreviewBody,
  type BatchPreviewView,
  BatchReplyRequest,
  BatchRequestBody,
  CreateRequest,
  MAX_BATCH_ITEMS,
  MeasureDraftRequest,
  type MeasureDraftView,
  type ProfileExcerpt,
  ReplyRequest,
} from "../../shared/requests.ts";
import { dataDir } from "../data-dir.ts";
import { ClientError, publicMessage, zodErrorBody } from "../errors.ts";
import { RateLimitError, takeClaudeSlot, takeMailSlot } from "../limits.ts";
import { type Mailer, mailerFromEnv, mailtoUrl } from "../mail/mailer.ts";
import { backgroundFor, questionFor } from "../requests/questions.ts";
import {
  AlreadyAnsweredError,
  InvalidBatchReplyError,
  InvalidReceivedAtError,
  NotAnsweredError,
  newId,
  RequestStore,
  type StoredBatch,
  type StoredRequest,
  StoreFullError,
  toView,
  UnknownChoiceError,
} from "../store/requests.ts";

export type RequestDeps = {
  store: RequestStore;
  mailer: Mailer;
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

export const defaultStoreFile = join(dataDir, "requests.json");

/** 環境変数から既定の依存を組む */
export function depsFromEnv(env: NodeJS.ProcessEnv = process.env): RequestDeps {
  return {
    store: new RequestStore({ file: env.UCHIDAI_REQUESTS_FILE ?? defaultStoreFile }),
    mailer: mailerFromEnv(env),
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

const ToAddress = z.string().email().max(200);

/** カルテ由来の文字列から、制御文字・双方向制御文字を取り除き、{{ }} を無害化する（BR-004）。メールの宛先はそのまま */
function cleanProfile(p: ProfileExcerpt): ProfileExcerpt {
  return {
    ...p,
    companyName: sanitizeName(p.companyName),
    ...(p.vendor ? { vendor: { ...p.vendor, name: sanitizeName(p.vendor.name) } } : {}),
    assets: p.assets.map((a) => ({ ...a, label: sanitizeName(a.label) })),
  };
}

export function requestRoutes(deps: RequestDeps = depsFromEnv()): Hono {
  const { store, mailer } = deps;
  /** 依頼文を Claude が書くか（writer.ts の判定と同じ：指定があればそれ、無ければ client かキーがあれば Claude） */
  const usesClaude = (writer: "claude" | "template" | undefined): boolean => {
    const w = writer ?? deps.writer?.writer;
    if (w) return w === "claude";
    return Boolean(deps.writer?.client || process.env.ANTHROPIC_API_KEY);
  };
  const now = deps.now ?? (() => new Date());
  const keepAliveMs = deps.keepAliveMs ?? 15_000;
  const maxSubscribers = deps.maxSubscribers ?? DEFAULT_MAX_SUBSCRIBERS;
  const maxRequests = deps.maxRequests ?? DEFAULT_MAX_REQUESTS;
  const r = new Hono();

  /** 作っている最中の依頼が使う保存の枠（await の間に届いた別の要求が、上限を超えないように。BR-001） */
  let reserved = 0;
  const reserve = (n: number): (() => void) | undefined => {
    if (store.size + reserved + n > maxRequests) return undefined;
    reserved += n;
    let released = false;
    return () => {
      if (!released) reserved -= n;
      released = true;
    };
  };
  const fullMessage = `依頼の保存が上限（${maxRequests} 件）に達しました。古い依頼を整理してください`;

  // この経路の中で、入力の形・上限・内部のエラーを、内部の情報を出さずに返す（SBR-015）
  r.onError((err, c) => {
    if (err instanceof RateLimitError)
      return c.json({ error: err.message }, 429, { "retry-after": String(err.retryAfterSec) });
    if (err instanceof ClientError) return c.json({ error: err.message }, err.status);
    if (err instanceof z.ZodError) return c.json(zodErrorBody(err), 400);
    if (err instanceof SyntaxError)
      return c.json({ error: "入力の形式が正しくありません（JSON として読めません）" }, 400);
    console.error(`[requests] ${c.req.method} ${c.req.path}:`, err);
    return c.json({ error: publicMessage(err) }, 500);
  });

  r.get("/", (c) => c.json({ items: store.list().map(toView), batches: store.listBatches() }));

  r.delete("/", (c) => c.json({ ok: true, cleared: store.clear(c.req.query("profileId")) }));

  r.get("/events", (c) => {
    if (store.subscriberCount >= maxSubscribers)
      return c.json(
        { error: "画面の同期の接続が多すぎます。他のタブを閉じてから開き直してください" },
        503,
      );
    return streamSSE(c, async (stream) => {
      let open = true;
      const unsub = store.subscribe((ev) => {
        void stream.writeSSE({
          event: ev.type,
          data: JSON.stringify(ev.event),
          id: ev.event.requestId,
        });
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
    const profile = cleanProfile(body.profile);
    const release = reserve(1);
    if (!release) return c.json({ error: fullMessage }, 429);
    try {
      const k = loadKnowledge();
      const asset = profile.assets.find((a) => a.id === body.assetId);
      if (!asset) return c.json({ error: `資産 ${body.assetId} がカルテにありません` }, 404);
      const q = questionFor(body.mitigation, asset.role);
      if (!q) return c.json({ error: `緩和策 ${body.mitigation} の質問はまだありません` }, 404);
      const bg = backgroundFor(body.mitigation, asset.role, k);
      const roleLabel = k.roles.find((x) => x.id === asset.role)?.labelJa ?? asset.role;
      const deadline = sanitizeName(body.deadline ?? defaultDeadline(now()));
      if (usesClaude(body.writer)) takeClaudeSlot("write"); // SEC-006。テンプレートの書き手は数えない
      const mail = await writeVendorRequest(
        {
          companyLabel: profile.companyName,
          vendorLabel: profile.vendor?.name,
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
        },
        { ...(deps.writer ?? {}), ...(body.writer ? { writer: body.writer } : {}) },
      );
      const to = body.to ?? profile.vendor?.email;
      // カルテのベンダーのメールも、送る直前に 1 件のアドレスの形か確かめる（SEC-007）
      if (to !== undefined && !ToAddress.safeParse(to).success)
        return c.json({ error: "宛先は 1 件のメールアドレスの形で入力してください" }, 400);
      if (to && mailer.via === "smtp") takeMailSlot(); // 1 分あたりの通数の上限（SBR-012、BR-006）
      const sent = await mailer.send({ to, subject: mail.subject, text: mail.text });
      const { ruleId: _rule, ...background } = bg;
      const item: StoredRequest = {
        id: newId(),
        ...(profile.id ? { profileId: profile.id } : {}),
        companyLabel: profile.companyName,
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
        mailtoUrl: sent.mailtoUrl,
        createdAt: now().toISOString(),
        sentVia: sent.via,
        ...(sent.sentAt ? { sentAt: sent.sentAt } : {}),
        ...(sent.error ? { sendError: sent.error } : {}),
        writer: mail.writer,
        choiceMap: q.choices,
      };
      try {
        store.add(item, maxRequests); // await の後でも、上限を見直す
      } catch (e) {
        if (e instanceof StoreFullError) return c.json({ error: e.message }, 429);
        throw e;
      }
      return c.json(
        {
          request: toView(item),
          ...(mail.fallbackReasonJa ? { writerNoteJa: mail.fallbackReasonJa } : {}),
        },
        201,
      );
    } finally {
      release();
    }
  });

  /** まとめ依頼の入力を検証して、文面と質問を組み立てる（プレビューと作成で同じ処理。保存も送信もしない） */
  function prepareBatch(body: BatchPreviewBody) {
    const profile = cleanProfile(body.profile);
    const k = loadKnowledge();
    // (assetId, mitigation) の重複を除く
    const seen = new Set<string>();
    const wanted = body.items.filter((i) => {
      const key = JSON.stringify([i.assetId, i.mitigation]);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (wanted.length > MAX_BATCH_ITEMS)
      throw new ClientError(400, `一度にまとめられるのは ${MAX_BATCH_ITEMS} 問までです`);
    const entries = wanted.map((i) => {
      const asset = profile.assets.find((a) => a.id === i.assetId);
      if (!asset) throw new ClientError(404, "カルテにない資産が含まれています");
      const q = questionFor(i.mitigation, asset.role);
      if (!q) throw new ClientError(404, `緩和策 ${i.mitigation} の質問はまだありません`);
      return { asset, q, bg: backgroundFor(i.mitigation, asset.role, k), mitigation: i.mitigation };
    });
    const to = body.to ?? profile.vendor?.email;
    if (to !== undefined && !ToAddress.safeParse(to).success)
      throw new ClientError(400, "宛先は 1 件のメールアドレスの形で入力してください");
    const deadline = sanitizeName(body.deadline ?? defaultDeadline(now()));
    const mail = writeBatchRequest({
      companyLabel: profile.companyName,
      vendorLabel: profile.vendor?.name,
      deadline,
      questions: entries.map((e) => ({
        assetLabel: e.asset.label,
        question: e.q.textJa,
        choices: e.q.choices.map((x) => x.labelJa),
      })),
    });
    return { profile, entries, to, deadline, mail };
  }

  r.post("/batch/preview", async (c) => {
    const body = BatchPreviewBody.parse(await c.req.json());
    const p = prepareBatch(body);
    const view: BatchPreviewView = {
      ...(p.to ? { to: p.to } : {}),
      subject: p.mail.subject,
      text: p.mail.text,
      mailtoUrl: mailtoUrl({ to: p.to, subject: p.mail.subject, text: p.mail.text }),
      deadline: p.deadline,
      items: p.entries.map((e) => ({
        assetId: e.asset.id,
        assetLabel: e.asset.label,
        mitigation: e.mitigation,
        mitigationLabelJa: e.bg.mitigationLabelJa,
        questionJa: e.q.textJa,
      })),
    };
    return c.json(view);
  });

  r.post("/batch", async (c) => {
    const body = BatchRequestBody.parse(await c.req.json());
    const p = prepareBatch(body);
    if (!p.to)
      return c.json({ error: "宛先がありません。ベンダーのメールアドレスを入力してください" }, 400);
    // プレビューで見せた文面と、送る文面は同じでなければならない（SBR-016）
    if (body.expectText !== undefined && body.expectText !== p.mail.text)
      return c.json(
        { error: "確認した文面と、いまの文面が変わりました。もう一度プレビューを確認してください" },
        409,
      );
    const release = reserve(1 + p.entries.length); // 親 1 ＋ 子 N
    if (!release) return c.json({ error: fullMessage }, 429);
    try {
      if (mailer.via === "smtp") takeMailSlot(); // 1 分あたりの通数の上限（SBR-012）
      const sent = await mailer.send({ to: p.to, subject: p.mail.subject, text: p.mail.text }); // 1 通だけ
      const parentId = newId();
      const common = {
        ...(p.profile.id ? { profileId: p.profile.id } : {}),
        companyLabel: p.profile.companyName,
        to: p.to,
        sentVia: sent.via,
        ...(sent.sentAt ? { sentAt: sent.sentAt } : {}),
        ...(sent.error ? { sendError: sent.error } : {}),
        createdAt: now().toISOString(),
      };
      const children: StoredRequest[] = p.entries.map((e) => {
        const { ruleId: _rule, ...background } = e.bg;
        return {
          id: newId(),
          parentId,
          ...common,
          assetId: e.asset.id,
          assetLabel: e.asset.label,
          mitigation: e.mitigation,
          background,
          question: {
            textJa: e.q.textJa,
            ...(e.q.hintJa ? { hintJa: e.q.hintJa } : {}),
            choices: e.q.choices.map((x) => ({ id: x.id, labelJa: x.labelJa })),
          },
          // 文面は親が持つ（子には写さない）
          subject: "",
          text: "",
          mailtoUrl: "",
          writer: "template",
          choiceMap: e.q.choices,
        };
      });
      const parent: StoredBatch = {
        id: parentId,
        kind: "batch",
        ...common,
        subject: p.mail.subject,
        text: p.mail.text,
        mailtoUrl: sent.mailtoUrl,
        writer: "template",
        childIds: children.map((x) => x.id),
      };
      try {
        store.addBatch(parent, children, maxRequests); // 親 1 ＋ 子 N を 1 回の保存で積む
      } catch (e) {
        if (e instanceof StoreFullError) return c.json({ error: e.message }, 429);
        throw e;
      }
      return c.json({ batch: parent, items: children.map(toView) }, 201);
    } finally {
      release();
    }
  });

  r.post("/batch/:id/reply", async (c) => {
    const body = BatchReplyRequest.parse(await c.req.json());
    try {
      const evs = store.recordBatchReply(c.req.param("id"), body);
      if (!evs) return c.json({ error: "このまとめ依頼は見つかりません" }, 404);
      const batch = store.batchById(c.req.param("id"));
      return c.json({
        ok: true,
        results: evs.map((ev) => ({
          requestId: ev.requestId,
          answer: ev.answer,
          choiceLabelJa: ev.choiceLabelJa,
        })),
        ...(batch ? { batch, items: store.childrenOf(batch.id).map(toView) } : {}),
      });
    } catch (e) {
      if (e instanceof AlreadyAnsweredError) return c.json({ error: e.message }, 409);
      if (
        e instanceof UnknownChoiceError ||
        e instanceof InvalidReceivedAtError ||
        e instanceof InvalidBatchReplyError
      )
        return c.json({ error: e.message }, 400);
      throw e;
    }
  });

  r.delete("/batch/:id", (c) => {
    const evs = store.deleteBatch(c.req.param("id"));
    if (!evs) return c.json({ error: "このまとめ依頼は見つかりません" }, 404);
    return c.json({ ok: true, retracted: evs });
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
    if (usesClaude(body.writer)) takeClaudeSlot("write");
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
        deadline: sanitizeName(body.deadline ?? defaultDeadline(now(), 30)),
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

  r.post("/:id/reply", async (c) => {
    const body = ReplyRequest.parse(await c.req.json());
    if (store.byId(c.req.param("id"))?.parentId)
      return c.json(
        { error: "これはまとめ依頼の質問です。まとめ依頼の返信として入力してください" },
        409,
      );
    try {
      const ev = store.recordReply(c.req.param("id"), body);
      if (!ev) return c.json({ error: "この依頼は見つかりません" }, 404);
      const request = store.byId(ev.requestId);
      return c.json({
        ok: true,
        answer: ev.answer,
        choiceLabelJa: ev.choiceLabelJa,
        ...(request ? { request: toView(request) } : {}),
      });
    } catch (e) {
      if (e instanceof AlreadyAnsweredError) return c.json({ error: e.message }, 409);
      if (e instanceof UnknownChoiceError || e instanceof InvalidReceivedAtError)
        return c.json({ error: e.message }, 400);
      throw e;
    }
  });

  r.delete("/:id/reply", (c) => {
    try {
      const ev = store.retract(c.req.param("id"));
      if (!ev) return c.json({ error: "この依頼は見つかりません" }, 404);
      return c.json({ ok: true, retracted: ev });
    } catch (e) {
      if (e instanceof NotAnsweredError) return c.json({ error: e.message }, 409);
      throw e;
    }
  });

  return r;
}
