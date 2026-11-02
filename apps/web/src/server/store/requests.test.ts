import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AlreadyAnsweredError,
  newToken,
  RequestStore,
  type StoredRequest,
  TOKEN_PATTERN,
  toView,
} from "./requests.ts";

function sample(token = newToken()): StoredRequest {
  return {
    id: `req_${token.slice(0, 6)}`,
    token,
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
    subject: "件名",
    text: "本文",
    answerUrl: `http://localhost:5173/#/answer/${token}`,
    mailtoUrl: "mailto:?subject=x",
    createdAt: "2026-11-05T00:00:00.000Z",
    sentVia: "outbox",
    writer: "template",
    choiceMap: [
      { id: "shared", labelJa: "全 PC で共通", status: "absent", attrs: { sharedPassword: true } },
      {
        id: "individual",
        labelJa: "PC ごとに個別",
        status: "present",
        attrs: { sharedPassword: false },
      },
      { id: "unknown", labelJa: "分からない", status: "unknown" },
    ],
  };
}

describe("トークン", () => {
  it("256 ビットの乱数を base64url にした 43 文字で、重複しない", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const t = newToken();
      expect(t).toMatch(TOKEN_PATTERN);
      seen.add(t);
    }
    expect(seen.size).toBe(2000);
  });
  it("連番や時刻ではない（先頭が同じになる率が低い）", () => {
    const heads = new Set(Array.from({ length: 200 }, () => newToken().slice(0, 4)));
    expect(heads.size).toBeGreaterThan(190);
  });
});

describe("RequestStore", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  it("回答を AnswerInput（根拠：ベンダー回答、誰がいつ、属性）に変換して購読者に流す", () => {
    const store = new RequestStore({ now: () => new Date("2026-11-05T10:00:00Z") });
    const it = store.add(sample());
    const got: unknown[] = [];
    const unsub = store.subscribe((ev) => got.push(ev));
    const ev = store.answer(it.token, { choice: "shared", answeredBy: " 保守ベンダー 田中 " });
    expect(ev?.answer).toEqual({
      assetId: "admin",
      mitigation: "M1026",
      status: "absent",
      evidence: "vendor",
      answeredBy: "保守ベンダー 田中",
      answeredAt: "2026-11-05T10:00:00.000Z",
      noteJa: "ベンダー回答：全 PC で共通（質問：管理者のパスワードは、全 PC で共通ですか）",
      attrs: { sharedPassword: true },
    });
    expect(ev?.profileId).toBe("demo-seiko");
    expect(got).toHaveLength(1);
    unsub();
    expect(store.subscriberCount).toBe(0);
    const view = toView(store.byId(it.id) as StoredRequest);
    expect(view.answeredBy).toBe("保守ベンダー 田中");
    expect(view.answer?.choiceLabelJa).toBe("全 PC で共通");
    expect("choiceMap" in view).toBe(false);
  });
  it("「分からない」は status unknown（engine 側で根拠なしに落ちる）", () => {
    const store = new RequestStore();
    const it = store.add(sample());
    const ev = store.answer(it.token, { choice: "unknown", answeredBy: "x" });
    expect(ev?.answer.status).toBe("unknown");
    expect(ev?.answer.attrs).toBeUndefined();
  });
  it("二重回答は AlreadyAnsweredError、無い選択肢と無いトークンも拒む", () => {
    const store = new RequestStore();
    const it = store.add(sample());
    store.answer(it.token, { choice: "individual", answeredBy: "x" });
    expect(() => store.answer(it.token, { choice: "shared", answeredBy: "y" })).toThrow(
      AlreadyAnsweredError,
    );
    const other = store.add(sample());
    expect(() => store.answer(other.token, { choice: "nope", answeredBy: "y" })).toThrow(/選択肢/);
    expect(store.answer(newToken(), { choice: "shared", answeredBy: "y" })).toBeUndefined();
  });
  it("JSON ファイルに保存し、作り直しても依頼と回答が残る", () => {
    const dir = mkdtempSync(join(tmpdir(), "uchidai-req-"));
    dirs.push(dir);
    const file = join(dir, "nested", "requests.json");
    const a = new RequestStore({ file });
    const it = a.add(sample());
    a.answer(it.token, { choice: "shared", answeredBy: "x" });
    expect(existsSync(file)).toBe(true);
    const raw = JSON.parse(readFileSync(file, "utf8"));
    expect(raw.items).toHaveLength(1);
    const b = new RequestStore({ file });
    expect(b.byToken(it.token)?.answer?.choice).toBe("shared");
    expect(() => b.answer(it.token, { choice: "shared", answeredBy: "x" })).toThrow(
      AlreadyAnsweredError,
    );
  });
  it("壊れた保存ファイルは形の合う項目だけ読み、残りは捨てる", () => {
    const dir = mkdtempSync(join(tmpdir(), "uchidai-req-"));
    dirs.push(dir);
    mkdirSync(join(dir, "d"));
    const file = join(dir, "d", "requests.json");
    const good = sample();
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        items: [good, { id: "broken" }, { ...sample(), token: "short" }, null, 42],
      }),
    );
    const store = new RequestStore({ file });
    expect(store.size).toBe(1);
    expect(store.byToken(good.token)?.id).toBe(good.id);
    // JSON として読めないファイルは空で始める
    writeFileSync(file, "{not json");
    expect(new RequestStore({ file }).size).toBe(0);
  });
  it("一覧は新しい順", () => {
    const store = new RequestStore();
    store.add({ ...sample(), createdAt: "2026-11-05T00:00:00.000Z" });
    store.add({ ...sample(), createdAt: "2026-11-06T00:00:00.000Z" });
    expect(store.list().map((x) => x.createdAt)).toEqual([
      "2026-11-06T00:00:00.000Z",
      "2026-11-05T00:00:00.000Z",
    ]);
  });
});
