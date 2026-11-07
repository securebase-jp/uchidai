/**
 * まとめて確認の、画面側の小さな決まり（選択、宛先の形、返信の組み立て、二重送信の防止、本文のコピー）。
 * どれも画面に依らない関数にして、単体で試験する。
 */
import {
  type BatchReplyRequest,
  type BatchView,
  MAX_BATCH_ITEMS,
  type RequestView,
} from "../../shared/requests.ts";

export const batchKey = (assetId: string, mitigation: string): string => `${assetId}:${mitigation}`;

export function parseBatchKey(key: string): { assetId: string; mitigation: string } {
  const i = key.lastIndexOf(":");
  return { assetId: key.slice(0, i), mitigation: key.slice(i + 1) };
}

/** 選択を切り替える。選んでいる分は外せる。上限（10 問）に達していたら、新しくは選ばない */
export function toggleSelected(selected: string[], key: string, max = MAX_BATCH_ITEMS): string[] {
  if (selected.includes(key)) return selected.filter((k) => k !== key);
  if (selected.length >= max) return selected;
  return [...selected, key];
}

/** 「この攻撃の経路で問われている項目だけ」を選ぶ（一覧の並びのまま、上限まで） */
export function selectOnPath(
  rows: { key: string; onPath: boolean; selectable: boolean }[],
  max = MAX_BATCH_ITEMS,
): string[] {
  return rows
    .filter((r) => r.onPath && r.selectable)
    .map((r) => r.key)
    .slice(0, max);
}

/** 宛先の形（1 件のメールアドレス）。サーバが改めて検証する。ここは「積む」ボタンを押せるかの目安 */
export function looksLikeEmail(s: string): boolean {
  return /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/.test(s.trim()) && s.trim().length <= 200;
}

/** 実行中の間は同じ操作を受け付けない（二重送信の防止）。実行中に呼ばれたら undefined を返す */
export function singleFlight<A extends unknown[], R>(
  fn: (...args: A) => Promise<R>,
): (...args: A) => Promise<R | undefined> {
  let running = false;
  return async (...args: A) => {
    if (running) return undefined;
    running = true;
    try {
      return await fn(...args);
    } finally {
      running = false;
    }
  };
}

/**
 * 本文をクリップボードへ。使えない・拒まれたときは false（画面は、選んで手でコピーできる欄を見せる）
 */
export async function copyText(
  text: string,
  clipboard: { writeText(text: string): Promise<void> } | undefined = (
    globalThis as { navigator?: { clipboard?: { writeText(text: string): Promise<void> } } }
  ).navigator?.clipboard,
): Promise<boolean> {
  if (!clipboard) return false;
  try {
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** 質問の状態：親の子を、まとめ依頼の順に並べる */
export function childrenOf(batch: BatchView, items: RequestView[]): RequestView[] {
  const by = new Map(items.map((i) => [i.id, i]));
  return batch.childIds.flatMap((id) => {
    const c = by.get(id);
    return c ? [c] : [];
  });
}

export type BatchProgress = "pending" | "partial" | "answered";
export function batchProgress(children: RequestView[]): BatchProgress {
  const n = children.filter((c) => c.answer).length;
  return n === 0 ? "pending" : n === children.length ? "answered" : "partial";
}

/**
 * 返信の入力から、サーバに送る形を作る。選んだ質問の分だけ送る（未入力の質問は残す）。
 * 何も選んでいない、回答者名か日時が空のときは理由を返す
 */
export function composeBatchReply(input: {
  picks: Record<string, string | undefined>;
  order: string[];
  repliedBy: string;
  receivedAt: string;
  enteredBy: string;
}): { body: BatchReplyRequest } | { error: string } {
  const answers = input.order.flatMap((requestId) => {
    const choice = input.picks[requestId];
    return choice ? [{ requestId, choice }] : [];
  });
  if (answers.length === 0) return { error: "答えのあった質問の番号を選んでください" };
  if (!input.repliedBy.trim()) return { error: "ご回答者の名前を入れてください" };
  const received = new Date(input.receivedAt);
  if (!input.receivedAt || Number.isNaN(received.getTime()))
    return { error: "返信を受け取った日時を入れてください" };
  const enteredBy = input.enteredBy.trim();
  return {
    body: {
      answers,
      repliedBy: input.repliedBy.trim(),
      receivedAt: received.toISOString(),
      ...(enteredBy ? { enteredBy } : {}),
    },
  };
}
