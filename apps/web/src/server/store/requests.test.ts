import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AlreadyAnsweredError,
  InvalidReceivedAtError,
  NotAnsweredError,
  RequestStore,
  type StoredRequest,
  toView,
} from "./requests.ts";

let seq = 0;
function sample(): StoredRequest {
  const id = `req_test${++seq}`;
  return {
    id,
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

const RECEIVED = "2026-11-05T09:30:00.000Z";
const NOW = () => new Date("2026-11-05T10:00:00Z");

describe("RequestStore", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  it("返信の入力を AnswerInput（根拠：ベンダー回答、ベンダー側の回答者、受け取った日時、属性）に変換して購読者に流し、入力者を残す", () => {
    const store = new RequestStore({ now: NOW });
    const it = store.add(sample());
    const got: unknown[] = [];
    const unsub = store.subscribe((ev) => got.push(ev));
    const ev = store.recordReply(it.id, {
      choice: "shared",
      repliedBy: " 保守ベンダー 田中 ",
      receivedAt: RECEIVED,
      enteredBy: " 情シス 山田 ",
    });
    expect(ev?.answer).toEqual({
      assetId: "admin",
      mitigation: "M1026",
      status: "absent",
      evidence: "vendor",
      answeredBy: "保守ベンダー 田中",
      answeredAt: RECEIVED,
      noteJa:
        "ベンダー回答：全 PC で共通（質問：管理者のパスワードは、全 PC で共通ですか）。返信メールの受領 11/5 18:30、入力：情シス 山田",
      attrs: { sharedPassword: true },
    });
    expect(ev?.profileId).toBe("demo-seiko");
    expect(got).toEqual([{ type: "answer", event: ev }]);
    unsub();
    expect(store.subscriberCount).toBe(0);
    const view = toView(store.byId(it.id) as StoredRequest);
    expect(view.answeredBy).toBe("保守ベンダー 田中");
    expect(view.answeredAt).toBe(RECEIVED);
    expect(view.enteredBy).toBe("情シス 山田");
    expect(view.enteredAt).toBe("2026-11-05T10:00:00.000Z");
    expect(view.answer?.choiceLabelJa).toBe("全 PC で共通");
    expect("choiceMap" in view).toBe(false);
  });
  it("入力者が空でも入力できる（備考には「担当者名なし」と書く）", () => {
    const store = new RequestStore({ now: NOW });
    const it = store.add(sample());
    const ev = store.recordReply(it.id, {
      choice: "individual",
      repliedBy: "田中",
      receivedAt: RECEIVED,
    });
    expect(ev?.answer.noteJa).toContain("入力：担当者名なし");
    expect(store.byId(it.id)?.enteredBy).toBeUndefined();
  });
  it("「分からない」は status unknown（engine 側で根拠なしに落ちる）", () => {
    const store = new RequestStore({ now: NOW });
    const it = store.add(sample());
    const ev = store.recordReply(it.id, {
      choice: "unknown",
      repliedBy: "x",
      receivedAt: RECEIVED,
    });
    expect(ev?.answer.status).toBe("unknown");
    expect(ev?.answer.attrs).toBeUndefined();
  });
  it("二重回答は AlreadyAnsweredError、無い選択肢と無い依頼も拒む", () => {
    const store = new RequestStore({ now: NOW });
    const it = store.add(sample());
    store.recordReply(it.id, { choice: "individual", repliedBy: "x", receivedAt: RECEIVED });
    expect(() =>
      store.recordReply(it.id, { choice: "shared", repliedBy: "y", receivedAt: RECEIVED }),
    ).toThrow(AlreadyAnsweredError);
    const other = store.add(sample());
    expect(() =>
      store.recordReply(other.id, { choice: "nope", repliedBy: "y", receivedAt: RECEIVED }),
    ).toThrow(/選択肢/);
    expect(
      store.recordReply("req_none", { choice: "shared", repliedBy: "y", receivedAt: RECEIVED }),
    ).toBeUndefined();
  });
  it("受け取った日時が読めない・未来（1 日より先）なら拒み、保存しない。時計のずれ程度は許す", () => {
    const store = new RequestStore({ now: NOW });
    const it = store.add(sample());
    for (const bad of ["昨日", "2026-11-07T10:00:00Z"])
      expect(() =>
        store.recordReply(it.id, { choice: "shared", repliedBy: "x", receivedAt: bad }),
      ).toThrow(InvalidReceivedAtError);
    expect(store.byId(it.id)?.answer).toBeUndefined();
    expect(
      store.recordReply(it.id, {
        choice: "shared",
        repliedBy: "x",
        receivedAt: "2026-11-05T10:10:00Z",
      }),
    ).toBeDefined();
  });
  it("回答を取り消すと回答待ちに戻り、取り消しを購読者に流す。同じ依頼にもう一度入力できる", () => {
    const store = new RequestStore({ now: NOW });
    const it = store.add(sample());
    const got: { type: string }[] = [];
    store.subscribe((ev) => got.push(ev));
    expect(() => store.retract(it.id)).toThrow(NotAnsweredError);
    store.recordReply(it.id, {
      choice: "shared",
      repliedBy: "田中",
      receivedAt: RECEIVED,
      enteredBy: "山田",
    });
    const ev = store.retract(it.id);
    expect(ev).toEqual({
      requestId: it.id,
      profileId: "demo-seiko",
      assetId: "admin",
      mitigation: "M1026",
    });
    const view = toView(store.byId(it.id) as StoredRequest);
    for (const k of ["answer", "answeredAt", "answeredBy", "enteredBy", "enteredAt"])
      expect(k in view, k).toBe(false);
    expect(got.map((g) => g.type)).toEqual(["answer", "retract"]);
    expect(
      store.recordReply(it.id, { choice: "individual", repliedBy: "鈴木", receivedAt: RECEIVED })
        ?.answer.status,
    ).toBe("present");
    expect(store.retract("req_none")).toBeUndefined();
  });
  it("JSON ファイルに保存し、作り直しても依頼と回答（入力者を含む）が残り、取り消しも残る", () => {
    const dir = mkdtempSync(join(tmpdir(), "uchidai-req-"));
    dirs.push(dir);
    const file = join(dir, "nested", "requests.json");
    const a = new RequestStore({ file, now: NOW });
    const it = a.add(sample());
    a.recordReply(it.id, {
      choice: "shared",
      repliedBy: "x",
      receivedAt: RECEIVED,
      enteredBy: "山田",
    });
    expect(existsSync(file)).toBe(true);
    const raw = JSON.parse(readFileSync(file, "utf8"));
    expect(raw.items).toHaveLength(1);
    const b = new RequestStore({ file, now: NOW });
    expect(b.byId(it.id)?.answer?.choice).toBe("shared");
    expect(b.byId(it.id)?.enteredBy).toBe("山田");
    expect(() =>
      b.recordReply(it.id, { choice: "shared", repliedBy: "x", receivedAt: RECEIVED }),
    ).toThrow(AlreadyAnsweredError);
    b.retract(it.id);
    expect(new RequestStore({ file, now: NOW }).byId(it.id)?.answer).toBeUndefined();
  });
  it("以前の版（回答ページ方式）の保存ファイルを読める：token と answerUrl は捨て、回答済みの内容はそのまま使え、取り消せる", () => {
    const dir = mkdtempSync(join(tmpdir(), "uchidai-req-"));
    dirs.push(dir);
    const file = join(dir, "requests.json");
    const legacyToken = "A".repeat(43);
    const answered = {
      ...sample(),
      token: legacyToken,
      answerUrl: `https://example.trycloudflare.com/#/answer/${legacyToken}`,
      answeredAt: "2026-11-04T01:00:00.000Z",
      answeredBy: "保守ベンダー 田中",
      answer: {
        choice: "shared",
        choiceLabelJa: "全 PC で共通",
        input: {
          assetId: "admin",
          mitigation: "M1026",
          status: "absent",
          evidence: "vendor",
          answeredBy: "保守ベンダー 田中",
          answeredAt: "2026-11-04T01:00:00.000Z",
          noteJa: "ベンダー回答：全 PC で共通（質問：管理者のパスワードは、全 PC で共通ですか）",
          attrs: { sharedPassword: true },
        },
      },
    };
    const waiting = {
      ...sample(),
      token: "B".repeat(43),
      answerUrl: "http://localhost:5173/#/answer/x",
    };
    writeFileSync(file, JSON.stringify({ version: 1, items: [answered, waiting] }));
    const store = new RequestStore({ file, now: NOW });
    expect(store.size).toBe(2);
    const view = toView(store.byId(answered.id) as StoredRequest);
    expect(view.answer?.input.status).toBe("absent");
    expect(view.answer?.input.answeredBy).toBe("保守ベンダー 田中");
    expect(view.enteredBy).toBeUndefined();
    expect("token" in view).toBe(false);
    expect("answerUrl" in view).toBe(false);
    // 回答待ちのままの古い依頼には、新しい方式で入力できる
    expect(
      store.recordReply(waiting.id, { choice: "individual", repliedBy: "x", receivedAt: RECEIVED })
        ?.answer.status,
    ).toBe("present");
    // 古い回答も取り消せる
    expect(store.retract(answered.id)?.assetId).toBe("admin");
    // 書き戻したファイルに token は残らない
    expect(readFileSync(file, "utf8")).not.toContain(legacyToken);
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
        items: [good, { id: "broken" }, { ...sample(), choiceMap: "x" }, null, 42],
      }),
    );
    const store = new RequestStore({ file, now: NOW });
    expect(store.size).toBe(1);
    expect(store.byId(good.id)?.id).toBe(good.id);
    // JSON として読めないファイルは空で始める
    writeFileSync(file, "{not json");
    expect(new RequestStore({ file, now: NOW }).size).toBe(0);
  });
  it("一覧は新しい順", () => {
    const store = new RequestStore({ now: NOW });
    store.add({ ...sample(), createdAt: "2026-11-05T00:00:00.000Z" });
    store.add({ ...sample(), createdAt: "2026-11-06T00:00:00.000Z" });
    expect(store.list().map((x) => x.createdAt)).toEqual([
      "2026-11-06T00:00:00.000Z",
      "2026-11-05T00:00:00.000Z",
    ]);
  });
});
