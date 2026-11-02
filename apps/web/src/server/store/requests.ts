/**
 * 確認依頼の保存：メモリ ＋ JSON ファイル（apps/web/.data/requests.json。git 管理外）。
 * 会社カルテは保存しない。持つのは依頼のトークン、質問、送った文面、回答だけ。
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { AnswerInput } from "../../shared/api.ts";
import type { AnswerEvent, RequestView } from "../../shared/requests.ts";
import type { Choice } from "../requests/questions.ts";

export type StoredRequest = RequestView & {
  /** 選択肢 → 回答の対応（回答ページには出さない） */
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

/** 推測できないトークン（256 ビットの乱数を base64url で） */
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}
export function newId(): string {
  return `req_${Date.now().toString(36)}_${randomBytes(4).toString("hex")}`;
}
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

type Listener = (ev: AnswerEvent) => void;

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
      const parsed = JSON.parse(readFileSync(this.file, "utf8")) as { items?: StoredRequest[] };
      for (const it of parsed.items ?? []) this.items.set(it.id, it);
    } catch (e) {
      console.error(`[requests] ${this.file} を読めません。空で始めます:`, e);
    }
  }
  private persist(): void {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify({ version: 1, items: [...this.items.values()] }, null, 2));
    renameSync(tmp, this.file);
  }

  add(item: StoredRequest): StoredRequest {
    this.items.set(item.id, item);
    this.persist();
    return item;
  }
  byToken(token: string): StoredRequest | undefined {
    for (const it of this.items.values()) if (it.token === token) return it;
    return undefined;
  }
  byId(id: string): StoredRequest | undefined {
    return this.items.get(id);
  }
  /** 新しい順 */
  list(): StoredRequest[] {
    return [...this.items.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  /** 回答を保存し、AnswerInput に変換して購読者に流す。二重回答は AlreadyAnsweredError */
  answer(token: string, input: { choice: string; answeredBy: string }): AnswerEvent | undefined {
    const it = this.byToken(token);
    if (!it) return undefined;
    if (it.answer) throw new AlreadyAnsweredError();
    const choice = it.choiceMap.find((c) => c.id === input.choice);
    if (!choice) throw new UnknownChoiceError(input.choice);
    const answeredAt = this.now().toISOString();
    const answeredBy = input.answeredBy.trim();
    const answer: AnswerInput = {
      assetId: it.assetId,
      mitigation: it.mitigation,
      status: choice.status,
      evidence: "vendor",
      answeredBy,
      answeredAt,
      noteJa: `ベンダー回答：${choice.labelJa}（質問：${it.question.textJa}）`,
      ...(choice.attrs ? { attrs: choice.attrs } : {}),
    };
    it.answeredAt = answeredAt;
    it.answeredBy = answeredBy;
    it.answer = { choice: choice.id, choiceLabelJa: choice.labelJa, input: answer };
    this.persist();
    const ev: AnswerEvent = {
      requestId: it.id,
      ...(it.profileId ? { profileId: it.profileId } : {}),
      assetLabel: it.assetLabel,
      choiceLabelJa: choice.labelJa,
      answer,
    };
    for (const l of this.listeners) l(ev);
    return ev;
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  get subscriberCount(): number {
    return this.listeners.size;
  }
}

/** 送信箱向けの形（choiceMap を落とす） */
export function toView(it: StoredRequest): RequestView {
  const { choiceMap: _omit, ...view } = it;
  return view;
}
