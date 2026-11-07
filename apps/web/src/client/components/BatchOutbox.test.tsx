import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { BatchView, RequestView } from "../../shared/requests.ts";
import { BatchReplyForm } from "./BatchOutbox.tsx";
import { BatchPreview } from "./BatchPreview.tsx";
import { CopyTextButton } from "./CopyTextButton.tsx";
import { OutboxPanel } from "./OutboxPanel.tsx";

const mkChild = (
  id: string,
  assetId: string,
  mitigation: string,
  over: Partial<RequestView> = {},
): RequestView => ({
  id,
  parentId: "b1",
  profileId: "demo-seiko",
  companyLabel: "デモ精工株式会社",
  assetId,
  assetLabel:
    assetId === "admin" ? "管理者アカウント" : assetId === "server" ? "業務サーバ" : "VPN装置",
  mitigation,
  background: { mitigationId: mitigation, mitigationLabelJa: `対策 ${mitigation}` },
  question: {
    textJa: `質問 ${mitigation}`,
    choices: [
      { id: "c-a", labelJa: "選択肢A" },
      { id: "c-b", labelJa: "選択肢B" },
      { id: "unknown", labelJa: "分からない" },
    ],
  },
  subject: "",
  text: "",
  mailtoUrl: "",
  createdAt: "2026-11-07T00:00:00.000Z",
  sentVia: "outbox",
  writer: "template",
  ...over,
});
const children: RequestView[] = [
  mkChild("c1", "admin", "M1026", {
    answeredBy: "田中",
    answeredAt: "2026-11-07T01:00:00.000Z",
    answer: {
      choice: "c-a",
      choiceLabelJa: "選択肢A",
      input: {
        assetId: "admin",
        mitigation: "M1026",
        status: "absent",
        evidence: "vendor",
        answeredBy: "田中",
      } as never,
    },
  }),
  mkChild("c2", "server", "M1053"),
  mkChild("c3", "vpn", "M1032"),
];
const batch: BatchView = {
  id: "b1",
  kind: "batch",
  profileId: "demo-seiko",
  companyLabel: "デモ精工株式会社",
  to: "vendor@example.com",
  subject: "【ご確認のお願い】3 点のご確認について（デモ精工株式会社）",
  text: "■ 質問 1／3\n…",
  mailtoUrl: "mailto:vendor%40example.com?subject=x",
  createdAt: "2026-11-07T00:00:00.000Z",
  sentVia: "outbox",
  writer: "template",
  childIds: ["c1", "c2", "c3"],
};
const noop = async () => undefined;
const render = (over: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    createElement(OutboxPanel, {
      items: children,
      batches: [batch],
      onReply: noop,
      onRetract: noop,
      onReplyBatch: noop,
      onDeleteBatch: noop,
      onClear: () => undefined,
      ...over,
    }),
  );

describe("送信箱のまとめ依頼", () => {
  it("まとめ依頼を 1 件として並べ、質問ごとの状態を出す。子は単独の依頼として並べない", () => {
    const m = render();
    expect(m).toContain("まとめて 3 問");
    expect(m).toContain("一部回答あり（1／3）");
    expect(m).toContain("質問 1／3");
    expect(m).toContain("質問 3／3");
    expect(m).toContain("回答待ち");
    expect(m).toContain("回答あり");
    expect(m).toContain('data-outbox-key="admin:M1026"');
    expect((m.match(/data-batch-id/g) ?? []).length).toBe(1);
    expect(m).not.toContain("返信を入力する</summary>"); // 単独の依頼の入力欄は出ない
    expect(m).toContain("送信箱を空にする（1 件）");
  });
  it("宛先を目立たせ、「本文をコピー」を主に、「メールソフトで開く」を補助に置く", () => {
    const m = render();
    expect(m).toContain("宛先：vendor@example.com");
    expect(m.indexOf("本文をコピー")).toBeLessThan(m.indexOf("メールソフトで開く"));
  });
  it("回答済みの質問に「回答を取り消す」が 1 つ、まとめ依頼に削除がある。残りの質問の数が分かる", () => {
    const m = render();
    expect((m.match(/回答を取り消す/g) ?? []).length).toBe(1);
    expect(m).toContain("このまとめ依頼を削除");
    expect(m).toContain("返信を入力する（残り 2 問）");
  });
  it("すべて回答済みなら入力欄は出ない。ハンドラが無い（デモなど）ときは、まとめ依頼を出さない", () => {
    const all = children.map((c) => ({ ...c, answer: children[0]?.answer }));
    expect(render({ items: all })).not.toContain("返信を入力する（残り");
    expect(render({ items: all })).toContain("すべて回答あり");
    const m = renderToStaticMarkup(
      createElement(OutboxPanel, {
        items: children,
        batches: [batch],
        onReply: noop,
        onRetract: noop,
      }),
    );
    expect(m).not.toContain("data-batch-id");
  });
  it("1 項目 1 依頼は従来どおり並ぶ", () => {
    const single = mkChild("s1", "admin", "M1026", { parentId: undefined as never });
    const m = renderToStaticMarkup(
      createElement(OutboxPanel, { items: [single], onReply: noop, onRetract: noop }),
    );
    expect(m).toContain("返信を入力する");
    expect(m).not.toContain("まとめて");
  });
});

describe("まとめ依頼の返信の入力欄（SBR-008）", () => {
  const pending = children.slice(1);
  it("質問ごとに番号を 1 から振り直し、回答者名と受領日時は 1 回だけ", () => {
    const m = renderToStaticMarkup(
      createElement(BatchReplyForm, { batch, pending, onReplyBatch: noop }),
    );
    expect(m).toContain("質問 2／3");
    expect(m).toContain("質問 3／3");
    expect(m).not.toContain("質問 1／3");
    expect((m.match(/<b class="num">1<\/b>/g) ?? []).length).toBe(2);
    expect((m.match(/<b class="num">3<\/b>/g) ?? []).length).toBe(2);
    expect((m.match(/ご回答者の名前/g) ?? []).length).toBe(1);
    expect((m.match(/返信を受け取った日時/g) ?? []).length).toBe(1);
    expect(m).toContain("選んだ 0 問の回答で判定を更新する");
    expect(m).toMatch(/<button[^>]*disabled=""[^>]*>選んだ 0 問/);
  });
});

describe("プレビュー", () => {
  const preview = {
    to: "vendor@example.com",
    subject: "件名",
    text: "本文\n■ 質問 1／2",
    mailtoUrl: "mailto:",
    deadline: "2026年11月14日",
    items: [],
  };
  const r = (to: string) =>
    renderToStaticMarkup(
      createElement(BatchPreview, {
        preview,
        to,
        onTo: () => undefined,
        busy: false,
        onConfirm: () => undefined,
        onCancel: () => undefined,
      }),
    );
  it("宛先と本文をそのまま見せ、宛先があれば「送信箱に積む」を押せる", () => {
    const m = r("vendor@example.com");
    expect(m).toContain('value="vendor@example.com"');
    expect(m).toContain("<pre>本文\n■ 質問 1／2</pre>");
    expect(m).not.toMatch(/<button[^>]*disabled=""[^>]*>送信箱に積む/);
  });
  it("宛先が未設定（または形が違う）なら押せず、理由を出す", () => {
    for (const to of ["", "x", "a@example.com, b@example.com"]) {
      const m = r(to);
      expect(m).toMatch(/<button[^>]*disabled=""[^>]*>送信箱に積む/);
      expect(m).toContain("宛先がありません");
    }
  });
});

describe("本文のコピー", () => {
  it("最初はボタンだけ（コピーできなかったときだけ、選べる本文の欄を出す）", () => {
    const m = renderToStaticMarkup(createElement(CopyTextButton, { text: "本文" }));
    expect(m).toContain("本文をコピー");
    expect(m).not.toContain("textarea");
  });
});
