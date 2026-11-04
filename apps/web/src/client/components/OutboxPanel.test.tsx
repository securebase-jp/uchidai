import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { RequestView } from "../../shared/requests.ts";
import { OutboxPanel } from "./OutboxPanel.tsx";

const base: RequestView = {
  id: "req_1",
  profileId: "demo-seiko",
  companyLabel: "デモ精工株式会社",
  assetId: "admin",
  assetLabel: "管理者アカウント",
  mitigation: "M1026",
  background: {
    mitigationId: "M1026",
    mitigationLabelJa: "特権アカウント管理",
    techniqueId: "T1003",
  },
  question: {
    textJa: "管理者のパスワードは、全 PC で共通ですか",
    choices: [
      { id: "shared", labelJa: "全 PC で共通" },
      { id: "individual", labelJa: "PC ごとに個別" },
      { id: "unknown", labelJa: "分からない" },
    ],
  },
  subject: "【ご確認のお願い】管理者アカウント",
  text: "本文",
  mailtoUrl: "mailto:?subject=x",
  createdAt: "2026-11-05T00:00:00.000Z",
  sentVia: "outbox",
  writer: "template",
};

const render = (items: RequestView[]) =>
  renderToStaticMarkup(
    createElement(OutboxPanel, {
      items,
      onReply: async () => undefined,
      onRetract: async () => undefined,
    }),
  );

describe("OutboxPanel", () => {
  it("回答待ちの依頼には「返信を入力する」があり、回答リンクや回答ページは出さない", () => {
    const m = render([base]);
    expect(m).toContain("回答待ち");
    expect(m).toContain("返信を入力する");
    expect(m).not.toContain("回答リンク");
    expect(m).not.toContain("回答ページ");
    expect(m).not.toContain("回答を取り消す");
  });
  it("回答済みの依頼には、ベンダー側の回答者・受領日時・入力者と「回答を取り消す」が出る", () => {
    const m = render([
      {
        ...base,
        answeredBy: "保守ベンダー 田中",
        answeredAt: "2026-11-05T09:30:00.000Z",
        enteredBy: "情シス 山田",
        enteredAt: "2026-11-05T10:00:00.000Z",
        answer: {
          choice: "shared",
          choiceLabelJa: "全 PC で共通",
          input: {
            assetId: "admin",
            mitigation: "M1026",
            status: "absent",
            evidence: "vendor",
            answeredBy: "保守ベンダー 田中",
            answeredAt: "2026-11-05T09:30:00.000Z",
          },
        },
      },
    ]);
    expect(m).toContain("回答あり");
    expect(m).toContain("保守ベンダー 田中");
    expect(m).toContain("受領");
    expect(m).toContain("入力：情シス 山田");
    expect(m).toContain("（根拠：ベンダー回答）");
    expect(m).toContain("回答を取り消す");
    expect(m).not.toContain("返信を入力する");
  });
  it("以前の版で回答済みの依頼（入力者の記録なし）も表示できる", () => {
    const m = render([
      {
        ...base,
        answeredBy: "田中",
        answeredAt: "2026-11-04T01:00:00.000Z",
        answer: {
          choice: "shared",
          choiceLabelJa: "全 PC で共通",
          input: {
            assetId: "admin",
            mitigation: "M1026",
            status: "absent",
            evidence: "vendor",
            answeredBy: "田中",
          },
        },
      },
    ]);
    expect(m).toContain("田中");
    expect(m).not.toContain("入力：");
    expect(m).toContain("回答を取り消す");
  });
});
