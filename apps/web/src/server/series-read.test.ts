/**
 * 同じ事故の複数の公表を 1 件として読む（TRIAL-I-005 の (b)）。
 * Claude も外部取得も呼ばない：取得（loadArticle）と読解（readCase）は差し替える
 */
import type { Article, readCase } from "@uchidai/llm";
import { describe, expect, it } from "vitest";
import { ClientError } from "./errors.ts";
import { readSeries } from "./series-read.ts";
import {
  detectPublishedDate,
  loadSeries,
  quoteSources,
  SeriesFetchError,
} from "./series-source.ts";

const BODY1 =
  "2025年10月10日 株式会社テスト。当社は不正アクセスを受け、サーバが暗号化されました。入口はまだ分かっていません。個人情報の漏えいの可能性があります。";
const BODY2 =
  "2025年11月5日 株式会社テスト。調査の結果、VPN装置から侵入されたことが確認されました。個人情報が持ち出されたことが確認されています。被害額は約5,000万円です。";
const BODY3 = "2025年12月1日 株式会社テスト。復旧が完了しました。再発防止策を実施します。";

const pages: Record<string, string> = {
  "https://example.test/r1": BODY1,
  "https://example.test/r2": BODY2,
  "https://example.test/r3": BODY3,
};
const loader = (async (input: { kind: string; url?: string }) => {
  const url = input.url as string;
  const text = pages[url];
  if (text === undefined) throw new ClientError(400, "記事が見つかりませんでした（404）。");
  return { kind: "html", text, title: `題 ${url.slice(-2)}`, sourceUrl: url } satisfies Article;
}) as unknown as Parameters<typeof loadSeries>[2] extends { loadArticle?: infer F } | undefined
  ? F
  : never;

describe("detectPublishedDate", () => {
  it("本文の先頭の年つきの日付を採る（全角・令和・スラッシュも）", () => {
    expect(detectPublishedDate({ text: "２０２５年１１月５日 各位" })).toBe("2025-11-05");
    expect(detectPublishedDate({ text: "令和7年10月1日\nお知らせ" })).toBe("2025-10-01");
    expect(detectPublishedDate({ text: "2025/7/3 お知らせ" })).toBe("2025-07-03");
  });
  it("年の無い日付は採らない。題・URL にあればそちらから", () => {
    expect(detectPublishedDate({ text: "10月1日に障害が発生しました" })).toBeUndefined();
    expect(detectPublishedDate({ text: "本文", title: "2025年9月2日のお知らせ" })).toBe(
      "2025-09-02",
    );
    expect(
      detectPublishedDate({ text: "本文", sourceUrl: "https://a.test/news/20251109/x.html" }),
    ).toBe("2025-11-09");
  });
});

describe("loadSeries", () => {
  it("公表日が全部取れれば日付順に並べ、見出し（第N報｜日付）を付けて連結する", async () => {
    const s = await loadSeries(
      ["https://example.test/r3", "https://example.test/r1", "https://example.test/r2"],
      "fail",
      { loadArticle: loader },
    );
    expect(s.order).toBe("date");
    expect(s.parts.map((p) => [p.label, p.date])).toEqual([
      ["第1報", "2025-10-10"],
      ["第2報", "2025-11-05"],
      ["第3報", "2025-12-01"],
    ]);
    expect(s.text).toMatch(/^【第1報｜2025-10-10｜/);
    expect(s.text).toContain("\n\n【第2報｜2025-11-05｜");
  });
  it("公表日が取れない報があれば、指定順のまま", async () => {
    const orig = pages["https://example.test/r1"];
    pages["https://example.test/r1"] = "日付のない本文です。サーバが暗号化されました。";
    try {
      const s = await loadSeries(["https://example.test/r2", "https://example.test/r1"], "fail", {
        loadArticle: loader,
      });
      expect(s.order).toBe("given");
      expect(s.parts.map((p) => p.url)).toEqual([
        "https://example.test/r2",
        "https://example.test/r1",
      ]);
    } finally {
      pages["https://example.test/r1"] = orig as string;
    }
  });
  it("同じ URL は一度だけ読む", async () => {
    const s = await loadSeries(["https://example.test/r1", "https://example.test/r1"], "fail", {
      loadArticle: loader,
    });
    expect(s.parts).toHaveLength(1);
  });
  it("失敗が 1 件でもあれば（fail）、どの URL がなぜ失敗したかを返す", async () => {
    const err = await loadSeries(["https://example.test/r1", "https://example.test/none"], "fail", {
      loadArticle: loader,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SeriesFetchError);
    const e = err as SeriesFetchError;
    expect(e.status).toBe(400);
    expect(e.failures).toEqual([
      { url: "https://example.test/none", message: "記事が見つかりませんでした（404）。" },
    ]);
    expect(e.message).toContain("https://example.test/none");
  });
  it("skip なら成功した分だけで読み、失敗を添える。すべて失敗ならエラー", async () => {
    const s = await loadSeries(["https://example.test/r1", "https://example.test/none"], "skip", {
      loadArticle: loader,
    });
    expect(s.parts).toHaveLength(1);
    expect(s.failures).toHaveLength(1);
    await expect(
      loadSeries(["https://example.test/none"], "skip", { loadArticle: loader }),
    ).rejects.toThrow(/どの公表も取得できませんでした/);
  });
});

describe("quoteSources", () => {
  it("根拠文がどの報の本文にあるかを、連結前の本文との照合で決める", () => {
    const parts = [
      { number: 1, text: BODY1 },
      { number: 2, text: BODY2 },
    ];
    const steps = [
      { quote: "VPN装置から侵入されたことが確認されました" },
      { quote: "個人情報の漏えいの可能性があります" },
      { quote: "どの報にも無い文章です。" },
      {},
    ] as { quote?: string }[];
    expect(quoteSources({ steps } as never, parts)).toEqual([[2], [1], null, null]);
  });
});

// ---- readSeries（読解を差し替える） ----
type Raw = Record<string, unknown>;
const step = (o: Raw) => ({
  tactic: "TA0001",
  techniques: ["T1190"],
  source: "stated",
  certainty: "confirmed",
  entryKind: null,
  published: null,
  impersonates: null,
  quote: null,
  summaryJa: "要約",
  ...o,
});
const rawCase = (o: Raw): Raw => ({
  title: "t",
  damageType: "ransomware",
  clarity: "partial",
  victim: null,
  leakedData: [],
  reportedLossJpy: null,
  averted: false,
  steps: [],
  suspiciousInstructions: [],
  ...o,
});
const fakeRead = (async (text: string) => {
  let raw: Raw;
  if (text.includes("【第1報")) {
    // 連結した本文：新しい報の事実（入口が VPN と確認）を根拠つきで読む
    raw = rawCase({
      steps: [
        step({
          entryKind: "vpn",
          quote: "調査の結果、VPN装置から侵入されたことが確認されました",
        }),
        step({
          tactic: "TA0040",
          techniques: ["T1486"],
          quote: "サーバが暗号化されました",
        }),
      ],
    });
  } else if (text.includes("入口はまだ分かっていません")) {
    raw = rawCase({
      steps: [
        step({
          certainty: "not_stated",
          source: "unknown",
          techniques: [],
          summaryJa: "入口の記載なし",
        }),
        step({ tactic: "TA0040", techniques: ["T1486"], quote: "サーバが暗号化されました" }),
      ],
    });
  } else if (text.includes("VPN装置から侵入")) {
    raw = rawCase({
      reportedLossJpy: 50_000_000,
      steps: [
        step({
          entryKind: "vpn",
          quote: "調査の結果、VPN装置から侵入されたことが確認されました",
        }),
      ],
    });
  } else {
    raw = rawCase({ damageType: "out_of_scope", clarity: "unknown", steps: [] });
  }
  return { value: raw, raw, model: "fake-model" };
}) as unknown as typeof readCase;

describe("readSeries", () => {
  it("連結を 1 件として読み、各報の読解から差分を作る。根拠文の出所の報も返す", async () => {
    const { merged, series } = await readSeries(
      ["https://example.test/r2", "https://example.test/r1", "https://example.test/r3"],
      "fail",
      { loadArticle: loader, readCase: fakeRead },
    );
    expect(series?.parts.map((p) => p.label)).toEqual(["第1報", "第2報", "第3報"]);
    // 本文は返さない
    expect(JSON.stringify(series?.parts)).not.toContain("サーバが暗号化");
    const c = merged.verified.case;
    expect(c.steps.map((s) => s.source)).toEqual(["stated", "stated"]);
    // 根拠文の出所：入口の根拠は第2報、暗号化の根拠は第1報
    expect(series?.quoteSources).toEqual([[2], [1]]);
    // 差分：第1報→第2報で入口が変わる。第3報（復旧のみ、段階なし）は比較から外れる
    expect(series?.view.reports.map((r) => r.readable)).toEqual([true, true, false]);
    const t = series?.view.transitions;
    expect(t).toHaveLength(1);
    expect(t?.[0]?.changesJa.join("")).toContain("入口が「分かっていません」から「VPN");
    expect(t?.[0]?.changesJa.join("")).toContain("被害額が約 5,000 万円と公表されました");
    expect(series?.view.summaryJa[0]).toMatch(/^第2報で、/);
    expect(series?.reports).toHaveLength(3);
  });
  it("1 件しか残らなければ（skip）、系列の比較は付けず、失敗だけ添える", async () => {
    const r = await readSeries(["https://example.test/r2", "https://example.test/none"], "skip", {
      loadArticle: loader,
      readCase: fakeRead,
    });
    expect(r.series).toBeUndefined();
    expect(r.loaded.failures.map((f) => f.url)).toEqual(["https://example.test/none"]);
  });
  it("連結が長すぎれば 422", async () => {
    const big = (async () => ({
      kind: "html",
      text: `2025年1月1日 ${"あ".repeat(80_000)}`,
    })) as unknown as typeof loader;
    await expect(
      readSeries(["https://example.test/a", "https://example.test/b"], "fail", {
        loadArticle: big,
        readCase: fakeRead,
      }),
    ).rejects.toMatchObject({ status: 422 });
  });
});
