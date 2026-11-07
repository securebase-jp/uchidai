/**
 * 記事を取得できなかったときの案内（純粋な関数）。判定には関わらない。
 * 理由（サーバの reason）ごとに、次の一手を一文で出し、詳しい説明は i ボタンの吹き出しに出す。
 * 新しい外部アクセスはしない：どの場合も、利用者が本文を貼る道へ案内するだけ
 */
import type { FetchFailReason, SeriesFailure } from "../../shared/api.ts";

export type FetchFailureGuide = {
  /** 画面に出す一文 */
  textJa: string;
  /** i ボタンの吹き出し（段落ごと） */
  detailJa: string[];
};

const PASTE_DETAIL =
  "ブラウザで記事を開き、本文を選んでコピーし、「本文」の欄に貼り付けてください。貼った本文は、取得を介さず、そのまま読みます。";

export function fetchFailureGuide(reason: FetchFailReason | undefined): FetchFailureGuide {
  switch (reason) {
    case "forbidden":
      return {
        textJa: "サイトが自動での取得を断りました。ブラウザで開いて、本文を貼ってください。",
        detailJa: [
          "企業のサイトには、プログラムからの取得を断るものがあります。ブラウザでは読めることが多いので、本文をコピーして貼るのが確実です。",
          "PDF の版が別にあるときは、その URL なら取得できることがあります。",
          PASTE_DETAIL,
        ],
      };
    case "not_found":
      return {
        textJa: "ページが見つかりませんでした。URL を確かめるか、本文を貼ってください。",
        detailJa: [
          "公表が移動・削除されたか、URL が違うかもしれません。ブラウザで開けるなら、その本文を貼れば読めます。",
          PASTE_DETAIL,
        ],
      };
    case "empty":
    case "thin":
      return {
        textJa: "本文が取れませんでした。PDF の版があればその URL、または本文を貼ってください。",
        detailJa: [
          "ページが読み込み後に表示される作りだったり、同意の画面だったりすると、本文が空か、ごく短くしか取れません。",
          "同じ公表の PDF の版があれば、その URL を入れてください（自動では探しません）。",
          PASTE_DETAIL,
        ],
      };
    case "bad_pdf":
      return {
        textJa: "PDF として読めませんでした。ブラウザで開いて、本文を貼ってください。",
        detailJa: [
          "URL の先が PDF ではない、または壊れている・パスワード付きの PDF かもしれません。",
          PASTE_DETAIL,
        ],
      };
    default:
      return {
        textJa: "本文を貼って読むこともできます。",
        detailJa: [PASTE_DETAIL],
      };
  }
}

/** 貼り付けの本文の下限（サーバの検証と同じ 40 字） */
export const MIN_PASTE_CHARS = 40;

/** 失敗した公表のうち、貼り付けで差し替えられるもの（URL が同じ）に、貼った本文を当てる */
export function pastesFor(
  pastes: Readonly<Record<string, string>>,
  urls: readonly string[],
): { url: string; text: string }[] {
  return urls.flatMap((url) => {
    const text = pastes[url]?.trim();
    return text && text.length >= MIN_PASTE_CHARS ? [{ url, text }] : [];
  });
}

/** 失敗の一覧から、まだ本文が貼られていないものだけを残す */
export function unpasted(
  failures: readonly SeriesFailure[],
  pastes: Readonly<Record<string, string>>,
): SeriesFailure[] {
  return failures.filter((f) => (pastes[f.url]?.trim().length ?? 0) < MIN_PASTE_CHARS);
}
