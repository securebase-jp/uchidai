/**
 * 確認依頼の保存：メモリ ＋ JSON ファイル（apps/web/.data/requests.json。git 管理外）。
 * 会社カルテは保存しない。持つのは依頼、質問、送った文面、担当者が入力した回答だけ。
 * 以前の版（回答ページ方式）の保存ファイルにある token と answerUrl は読み込むときに捨てる（回答済みの内容はそのまま使える）。
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import type { AnswerInput } from "../../shared/api.ts";
import type { AnswerEvent, RequestView, RetractEvent } from "../../shared/requests.ts";
import type { Choice } from "../requests/questions.ts";

export type StoredRequest = RequestView & {
  /** 選択肢 → 回答の対応（画面には出さない） */
  choiceMap: Choice[];
};

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

export function newId(): string {
  return `req_${Date.now().toString(36)}_${randomBytes(4).toString("hex")}`;
}

/**
 * 保存ファイルから読むときの最低限の形。壊れた項目は捨てて、残りで始める。
 * 緩く読む：判定に使う項目だけ見て、他（以前の版の token や answerUrl を含む）は looseObject で通す
 */
const StoredShape = z.looseObject({
  id: z.string().min(1),
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
      for (const raw of Array.isArray(parsed.items) ? parsed.items : []) {
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
        this.items.set(it.id, it);
      }
      if (dropped > 0)
        console.error(`[requests] ${this.file}：形の壊れた依頼 ${dropped} 件を読み飛ばしました`);
    } catch (e) {
      console.error(`[requests] ${this.file} を読めません。空で始めます:`, e);
    }
  }
  /** 一時ファイルに書いてから置き換える（途中で止まっても元のファイルは壊れない） */
  private persist(): void {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.${randomBytes(3).toString("hex")}.tmp`;
    writeFileSync(tmp, JSON.stringify({ version: 1, items: [...this.items.values()] }, null, 2));
    renameSync(tmp, this.file);
  }

  add(item: StoredRequest): StoredRequest {
    this.items.set(item.id, item);
    this.persist();
    return item;
  }
  /**
   * 送信箱を空にする（録画前などに使う）。メモリと保存ファイルの両方を空にし、消した件数を返す。
   * profileId を渡すと、そのカルテの依頼だけを消す（他のカルテの依頼は残す）
   */
  clear(profileId?: string): number {
    let n = 0;
    for (const [id, it] of this.items) {
      if (profileId !== undefined && it.profileId !== profileId) continue;
      this.items.delete(id);
      n++;
    }
    this.persist();
    return n;
  }
  byId(id: string): StoredRequest | undefined {
    return this.items.get(id);
  }
  /** 新しい順 */
  list(): StoredRequest[] {
    return [...this.items.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
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
    it.answeredAt = answeredAt;
    it.answeredBy = answeredBy;
    if (enteredBy) it.enteredBy = enteredBy;
    else delete it.enteredBy;
    it.enteredAt = now.toISOString();
    it.answer = { choice: choice.id, choiceLabelJa: choice.labelJa, input: answer };
    this.persist();
    const ev: AnswerEvent = {
      requestId: it.id,
      ...(it.profileId ? { profileId: it.profileId } : {}),
      assetLabel: it.assetLabel,
      choiceLabelJa: choice.labelJa,
      answer,
    };
    for (const l of this.listeners) l({ type: "answer", event: ev });
    return ev;
  }

  /** 入力した回答を取り消し、依頼を回答待ちに戻す（間違いの訂正用）。回答が無ければ NotAnsweredError */
  retract(id: string): RetractEvent | undefined {
    const it = this.items.get(id);
    if (!it) return undefined;
    if (!it.answer) throw new NotAnsweredError();
    delete it.answer;
    delete it.answeredAt;
    delete it.answeredBy;
    delete it.enteredBy;
    delete it.enteredAt;
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

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  get subscriberCount(): number {
    return this.listeners.size;
  }
  get size(): number {
    return this.items.size;
  }
}

/** 送信箱向けの形（choiceMap を落とす） */
export function toView(it: StoredRequest): RequestView {
  const { choiceMap: _omit, ...view } = it;
  return view;
}
