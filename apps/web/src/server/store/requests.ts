/**
 * 確認依頼の保存：メモリ ＋ JSON ファイル（apps/web/.data/requests.json。git 管理外）。
 * 会社カルテは保存しない。持つのは依頼、質問、送った文面、担当者が入力した回答だけ。
 * 以前の版（回答ページ方式）の保存ファイルにある token と answerUrl は読み込むときに捨てる（回答済みの内容はそのまま使える）。
 * まとめ依頼は「子の依頼 N 件（parentId）＋親 1 件（kind: "batch"）」で保存する（version 2。親子の無い古い版もそのまま読める）。
 * 読み込みでは、親子の整合（親の無い子、子の無い親、親と profileId／to が違う子は捨てる）と、
 * 回答の形（選択肢が choiceMap にある、資産・緩和策が依頼と同じ、根拠がベンダー回答）を検査し、合わない回答だけ捨てる。
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import type { AnswerInput } from "../../shared/api.ts";
import type { AnswerEvent, BatchView, RequestView, RetractEvent } from "../../shared/requests.ts";
import type { Choice } from "../requests/questions.ts";

export type StoredRequest = RequestView & {
  /** 選択肢 → 回答の対応（画面には出さない） */
  choiceMap: Choice[];
};
export type StoredBatch = BatchView;

export class AlreadyAnsweredError extends Error {
  constructor() {
    super("この依頼にはすでに回答があります");
    this.name = "AlreadyAnsweredError";
  }
}
export class UnknownChoiceError extends Error {
  constructor(choice: string) {
    super(`選択肢「${choice}」はこの質問にありません`);
    this.name = "UnknownChoiceError";
  }
}

export class NotAnsweredError extends Error {
  constructor() {
    super("この依頼にはまだ回答がありません");
    this.name = "NotAnsweredError";
  }
}
export class InvalidReceivedAtError extends Error {
  constructor(reason: string) {
    super(`返信を受け取った日時が正しくありません（${reason}）`);
    this.name = "InvalidReceivedAtError";
  }
}

/** 保存の上限を超える */
export class StoreFullError extends Error {
  constructor(max: number) {
    super(`依頼の保存が上限（${max} 件）に達しました。古い依頼を整理してください`);
    this.name = "StoreFullError";
  }
}
/** まとめ依頼の返信の入力が正しくない（親の質問でない id、同じ質問の重複など） */
export class InvalidBatchReplyError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "InvalidBatchReplyError";
  }
}

export function newId(): string {
  return `req_${Date.now().toString(36)}_${randomBytes(4).toString("hex")}`;
}

/**
 * 保存ファイルから読むときの最低限の形。壊れた項目は捨てて、残りで始める。
 * 緩く読む：判定に使う項目だけ見て、他（以前の版の token や answerUrl を含む）は looseObject で通す
 */
const StoredShape = z.looseObject({
  id: z.string().min(1),
  profileId: z.string().optional(),
  parentId: z.string().min(1).optional(),
  to: z.string().optional(),
  assetId: z.string(),
  assetLabel: z.string(),
  mitigation: z.string(),
  companyLabel: z.string(),
  createdAt: z.string(),
  question: z.looseObject({
    textJa: z.string(),
    choices: z.array(z.looseObject({ id: z.string(), labelJa: z.string() })),
  }),
  choiceMap: z.array(
    z.looseObject({
      id: z.string(),
      labelJa: z.string(),
      status: z.enum(["present", "absent", "unknown"]),
    }),
  ),
});

const StoredBatchShape = z.looseObject({
  id: z.string().min(1),
  kind: z.literal("batch"),
  profileId: z.string().optional(),
  to: z.string().optional(),
  companyLabel: z.string(),
  createdAt: z.string(),
  subject: z.string(),
  text: z.string(),
  mailtoUrl: z.string(),
  childIds: z.array(z.string()),
});

/** 選択肢（画面に出す question.choices）と choiceMap の id の並びが同じか（BR-007） */
function sameChoices(it: StoredRequest): boolean {
  const a = it.question.choices.map((c) => c.id);
  const b = it.choiceMap.map((c) => c.id);
  return a.length === b.length && a.every((id, i) => id === b[i]) && new Set(a).size === a.length;
}

/** 保存された回答が、依頼と合っているか（SBR-014、BR-005） */
function answerMatches(it: StoredRequest): boolean {
  const a = it.answer;
  if (!a) return true;
  const choice = it.choiceMap.find((c) => c.id === a.choice);
  const input = a.input as Partial<AnswerInput> | undefined;
  return (
    choice !== undefined &&
    input !== undefined &&
    input.assetId === it.assetId &&
    input.mitigation === it.mitigation &&
    input.evidence === "vendor" &&
    input.status === choice.status
  );
}

function clearAnswerFields(it: StoredRequest): void {
  delete it.answer;
  delete it.answeredAt;
  delete it.answeredBy;
  delete it.enteredBy;
  delete it.enteredAt;
}

/** 購読者に流す出来事：返信の入力、回答の取り消し */
export type StoreEvent =
  | { type: "answer"; event: AnswerEvent }
  | { type: "retract"; event: RetractEvent };
type Listener = (ev: StoreEvent) => void;

/** 受け取った日時が、いまよりこれ以上先なら入力ミスとみなす（端末の時計のずれは許す） */
const MAX_FUTURE_MS = 24 * 3_600_000;

const JA_WHEN = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export type StoreOptions = {
  /** 保存先。undefined ならメモリだけ（テスト用） */
  file?: string | undefined;
  now?: () => Date;
};

export class RequestStore {
  private readonly items = new Map<string, StoredRequest>();
  private readonly batches = new Map<string, StoredBatch>();
  private readonly listeners = new Set<Listener>();
  private readonly file: string | undefined;
  private readonly now: () => Date;

  constructor(opts: StoreOptions = {}) {
    this.file = opts.file;
    this.now = opts.now ?? (() => new Date());
    this.load();
  }

  private load(): void {
    if (!this.file || !existsSync(this.file)) return;
    try {
      const parsed = JSON.parse(readFileSync(this.file, "utf8")) as { items?: unknown[] };
      let dropped = 0;
      const batches = new Map<string, StoredBatch>();
      const requests: StoredRequest[] = [];
      for (const raw of Array.isArray(parsed.items) ? parsed.items : []) {
        if ((raw as { kind?: unknown } | null)?.kind === "batch") {
          const b = StoredBatchShape.safeParse(raw);
          if (b.success) batches.set(b.data.id, b.data as unknown as StoredBatch);
          else dropped++;
          continue;
        }
        const ok = StoredShape.safeParse(raw);
        if (!ok.success) {
          dropped++;
          continue;
        }
        const {
          token: _token,
          answerUrl: _answerUrl,
          ...it
        } = ok.data as unknown as StoredRequest & {
          token?: unknown;
          answerUrl?: unknown;
        };
        if (!sameChoices(it)) {
          dropped++;
          continue;
        }
        if (!answerMatches(it)) {
          console.error(
            `[requests] ${it.id}：依頼と合わない回答（選択肢・資産・緩和策・根拠）を読み飛ばしました`,
          );
          clearAnswerFields(it);
        }
        requests.push(it);
      }
      // 親子の整合：親の無い子、親と profileId／to が違う子は捨てる。子の無い親も捨てる
      const kids = new Map<string, StoredRequest[]>();
      for (const it of requests) {
        if (!it.parentId) {
          this.items.set(it.id, it);
          continue;
        }
        const parent = batches.get(it.parentId);
        if (!parent || parent.profileId !== it.profileId || parent.to !== it.to) {
          dropped++;
          continue;
        }
        kids.set(parent.id, [...(kids.get(parent.id) ?? []), it]);
      }
      for (const [id, parent] of batches) {
        const children = kids.get(id) ?? [];
        if (children.length === 0) {
          dropped++;
          continue;
        }
        const order = (c: StoredRequest) => {
          const i = parent.childIds.indexOf(c.id);
          return i < 0 ? Number.MAX_SAFE_INTEGER : i;
        };
        children.sort((x, y) => order(x) - order(y));
        for (const c of children) this.items.set(c.id, c);
        this.batches.set(id, { ...parent, childIds: children.map((c) => c.id) });
      }
      if (dropped > 0)
        console.error(`[requests] ${this.file}：形の壊れた依頼 ${dropped} 件を読み飛ばしました`);
    } catch (e) {
      console.error(`[requests] ${this.file} を読めません。空で始めます:`, e);
    }
  }
  /**
   * 一時ファイルに書いてから置き換える（途中で止まっても元のファイルは壊れない）。
   * 依頼文には宛先や資産名が入るので、所有者だけが読み書きできる権限（0600、親ディレクトリは 0700）で作る（Windows では無視される）
   */
  private persist(): void {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.${process.pid}.${randomBytes(3).toString("hex")}.tmp`;
    writeFileSync(
      tmp,
      JSON.stringify(
        { version: 2, items: [...this.batches.values(), ...this.items.values()] },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    renameSync(tmp, this.file);
  }

  /** 1 項目 1 依頼を積む。max を渡すと、await の後でも上限を見直して超えたら StoreFullError */
  add(item: StoredRequest, max?: number): StoredRequest {
    if (max !== undefined && this.size + 1 > max) throw new StoreFullError(max);
    this.items.set(item.id, item);
    try {
      this.persist();
    } catch (e) {
      this.items.delete(item.id);
      throw e;
    }
    return item;
  }
  /** まとめ依頼（親 1 ＋ 子 N）を、1 回の保存で積む。親 1 ＋ 子 N が上限を超えるなら何も積まず StoreFullError */
  addBatch(parent: StoredBatch, children: StoredRequest[], max?: number): void {
    if (max !== undefined && this.size + 1 + children.length > max) throw new StoreFullError(max);
    this.batches.set(parent.id, parent);
    for (const c of children) this.items.set(c.id, c);
    try {
      this.persist();
    } catch (e) {
      this.batches.delete(parent.id);
      for (const c of children) this.items.delete(c.id);
      throw e;
    }
  }
  /**
   * 送信箱を空にする（録画前などに使う）。メモリと保存ファイルの両方を空にし、消した件数（親と子を含む）を返す。
   * profileId を渡すと、そのカルテの依頼だけを消す（他のカルテの依頼は残す）。親子は一緒に消し、孤児（親の無い子、子の無い親）を残さない
   */
  clear(profileId?: string): number {
    let n = 0;
    for (const [id, it] of this.items) {
      if (profileId !== undefined && it.profileId !== profileId) continue;
      this.items.delete(id);
      n++;
    }
    for (const [id, b] of this.batches) {
      if (profileId !== undefined && b.profileId !== profileId) continue;
      this.batches.delete(id);
      n++;
    }
    n += this.dropOrphans();
    this.persist();
    return n;
  }
  /** 親の無い子と、子の無い親を取り除く（clear の後始末）。消した件数を返す */
  private dropOrphans(): number {
    let n = 0;
    for (const [id, it] of this.items) {
      if (it.parentId && !this.batches.has(it.parentId)) {
        this.items.delete(id);
        n++;
      }
    }
    const used = new Set<string>();
    for (const it of this.items.values()) if (it.parentId) used.add(it.parentId);
    for (const id of this.batches.keys()) {
      if (!used.has(id)) {
        this.batches.delete(id);
        n++;
      }
    }
    return n;
  }
  byId(id: string): StoredRequest | undefined {
    return this.items.get(id);
  }
  batchById(id: string): StoredBatch | undefined {
    return this.batches.get(id);
  }
  /** 新しい順（まとめ依頼の子も含む。親は listBatches） */
  list(): StoredRequest[] {
    return [...this.items.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }
  /** まとめ依頼の親（新しい順） */
  listBatches(): StoredBatch[] {
    return [...this.batches.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }
  /** 親の子（質問の順） */
  childrenOf(parentId: string): StoredRequest[] {
    const b = this.batches.get(parentId);
    if (!b) return [];
    return b.childIds.flatMap((id) => {
      const c = this.items.get(id);
      return c ? [c] : [];
    });
  }

  /**
   * 返信の入力を検証して、回答（AnswerInput）と更新後の依頼を作る。何も変えない（検証だけ）。
   * 二重回答は AlreadyAnsweredError、未知の選択肢は UnknownChoiceError、読めない日時は InvalidReceivedAtError
   */
  private buildReply(
    it: StoredRequest,
    input: {
      choice: string;
      repliedBy: string;
      receivedAt: string;
      enteredBy?: string | undefined;
    },
  ): { next: StoredRequest; ev: AnswerEvent } {
    if (it.answer) throw new AlreadyAnsweredError();
    const choice = it.choiceMap.find((c) => c.id === input.choice);
    if (!choice) throw new UnknownChoiceError(input.choice);
    const now = this.now();
    const received = new Date(input.receivedAt);
    if (Number.isNaN(received.getTime())) throw new InvalidReceivedAtError("日時として読めません");
    if (received.getTime() - now.getTime() > MAX_FUTURE_MS)
      throw new InvalidReceivedAtError("未来の日時です");
    const answeredAt = received.toISOString();
    const answeredBy = input.repliedBy.trim();
    const enteredBy = input.enteredBy?.trim() || undefined;
    const answer: AnswerInput = {
      assetId: it.assetId,
      mitigation: it.mitigation,
      status: choice.status,
      evidence: "vendor",
      answeredBy,
      answeredAt,
      noteJa: `ベンダー回答：${choice.labelJa}（質問：${it.question.textJa}）。返信メールの受領 ${JA_WHEN.format(received)}、入力：${enteredBy ?? "担当者名なし"}`,
      ...(choice.attrs ? { attrs: choice.attrs } : {}),
    };
    const next: StoredRequest = { ...it, answeredAt, answeredBy, enteredAt: now.toISOString() };
    if (enteredBy) next.enteredBy = enteredBy;
    else delete next.enteredBy;
    next.answer = { choice: choice.id, choiceLabelJa: choice.labelJa, input: answer };
    const ev: AnswerEvent = {
      requestId: it.id,
      ...(it.profileId ? { profileId: it.profileId } : {}),
      assetLabel: it.assetLabel,
      choiceLabelJa: choice.labelJa,
      answer,
    };
    return { next, ev };
  }

  /**
   * 担当者が入力した返信を保存し、AnswerInput に変換して購読者に流す。二重回答は AlreadyAnsweredError。
   * answeredBy は返信に書かれていたベンダー側の回答者、answeredAt は返信メールを受け取った日時。
   * 入力した担当者と入力日時は依頼に残し、判定の根拠の備考（noteJa）にも書く
   */
  recordReply(
    id: string,
    input: {
      choice: string;
      repliedBy: string;
      receivedAt: string;
      enteredBy?: string | undefined;
    },
  ): AnswerEvent | undefined {
    const it = this.items.get(id);
    if (!it) return undefined;
    const { next, ev } = this.buildReply(it, input);
    this.items.set(id, next);
    try {
      this.persist();
    } catch (e) {
      this.items.set(id, it);
      throw e;
    }
    for (const l of this.listeners) l({ type: "answer", event: ev });
    return ev;
  }

  /**
   * まとめ依頼の返信を、原子的に反映する（SBR-004/005）。入力した質問の全件を検証してから全件を適用し、
   * 1 回の保存のあとで answer イベントを件数ぶん流す。1 件でも落ちたら何も変えない（保存も SSE も起きない）。
   * 親が無ければ undefined。親の子でない id・同じ質問の重複は InvalidBatchReplyError、回答済みの子を含めば AlreadyAnsweredError
   */
  recordBatchReply(
    parentId: string,
    input: {
      answers: { requestId: string; choice: string }[];
      repliedBy: string;
      receivedAt: string;
      enteredBy?: string | undefined;
    },
  ): AnswerEvent[] | undefined {
    const parent = this.batches.get(parentId);
    if (!parent) return undefined;
    const seen = new Set<string>();
    const targets: { it: StoredRequest; choice: string }[] = [];
    for (const a of input.answers) {
      const it = this.items.get(a.requestId);
      if (!it || it.parentId !== parentId || !parent.childIds.includes(a.requestId))
        throw new InvalidBatchReplyError("このまとめ依頼の質問ではない項目が含まれています");
      if (seen.has(a.requestId))
        throw new InvalidBatchReplyError("同じ質問への回答が重なっています");
      seen.add(a.requestId);
      targets.push({ it, choice: a.choice });
    }
    if (targets.some((t) => t.it.answer)) throw new AlreadyAnsweredError();
    const built = targets.map((t) =>
      this.buildReply(t.it, {
        choice: t.choice,
        repliedBy: input.repliedBy,
        receivedAt: input.receivedAt,
        enteredBy: input.enteredBy,
      }),
    );
    for (const b of built) this.items.set(b.next.id, b.next);
    try {
      this.persist();
    } catch (e) {
      for (const t of targets) this.items.set(t.it.id, t.it);
      throw e;
    }
    const events = built.map((b) => b.ev);
    for (const ev of events) for (const l of this.listeners) l({ type: "answer", event: ev });
    return events;
  }

  /** 入力した回答を取り消し、依頼を回答待ちに戻す（間違いの訂正用）。回答が無ければ NotAnsweredError */
  retract(id: string): RetractEvent | undefined {
    const it = this.items.get(id);
    if (!it) return undefined;
    if (!it.answer) throw new NotAnsweredError();
    clearAnswerFields(it);
    this.persist();
    const ev: RetractEvent = {
      requestId: it.id,
      ...(it.profileId ? { profileId: it.profileId } : {}),
      assetId: it.assetId,
      mitigation: it.mitigation,
    };
    for (const l of this.listeners) l({ type: "retract", event: ev });
    return ev;
  }

  /**
   * まとめ依頼の親を消す（SBR-006）。回答済みの子は取り消し（retract イベント）、子はすべて削除する。孤児は残さない。
   * 親が無ければ undefined。取り消した回答の retract イベントを返す
   */
  deleteBatch(parentId: string): RetractEvent[] | undefined {
    const parent = this.batches.get(parentId);
    if (!parent) return undefined;
    const children = this.childrenOf(parentId);
    const events: RetractEvent[] = children
      .filter((c) => c.answer)
      .map((c) => ({
        requestId: c.id,
        ...(c.profileId ? { profileId: c.profileId } : {}),
        assetId: c.assetId,
        mitigation: c.mitigation,
      }));
    this.batches.delete(parentId);
    for (const c of children) this.items.delete(c.id);
    try {
      this.persist();
    } catch (e) {
      this.batches.set(parentId, parent);
      for (const c of children) this.items.set(c.id, c);
      throw e;
    }
    for (const ev of events) for (const l of this.listeners) l({ type: "retract", event: ev });
    return events;
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  get subscriberCount(): number {
    return this.listeners.size;
  }
  /** 保存している件数（まとめ依頼は親 1 ＋ 子 N） */
  get size(): number {
    return this.items.size + this.batches.size;
  }
}

/** 送信箱向けの形（choiceMap を落とす） */
export function toView(it: StoredRequest): RequestView {
  const { choiceMap: _omit, ...view } = it;
  return view;
}
