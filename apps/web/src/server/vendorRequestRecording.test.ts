/**
 * デモ場面 5 のベンダー確認依頼の記録（demo/recordings/vendor-request.demo-seiko.json）：
 * 形、Claude の実際の出力であること、番号つきの本文、サーバの質問表との一致、
 * 返信の入力がサーバの recordReply と同じ回答になること、秘密が混ざっていないこと
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CompanyProfile, repoRoot } from "@uchidai/engine";
import { describe, expect, it } from "vitest";
import {
  answerFromReply,
  DEMO_REQUEST_ID,
  findSecretLike,
  parseVendorRequestRecording,
  requestFromRecording,
} from "../shared/vendorRequestRecording.ts";
import { questionFor } from "./requests/questions.ts";
import { RequestStore, type StoredRequest } from "./store/requests.ts";

const raw = readFileSync(
  join(repoRoot, "demo", "recordings", "vendor-request.demo-seiko.json"),
  "utf8",
);
const rec = parseVendorRequestRecording(JSON.parse(raw));
/** 記録の選択肢の写し（optional の undefined を落として、サーバ側の Choice の形にする） */
const choiceMap = rec.choiceMap.map((c) => ({
  id: c.id,
  labelJa: c.labelJa,
  status: c.status,
  ...(c.attrs ? { attrs: c.attrs } : {}),
}));
const profile = CompanyProfile.parse(
  JSON.parse(readFileSync(join(repoRoot, "examples", "demo-seiko.json"), "utf8")),
);

describe("ベンダー確認依頼の記録", () => {
  it("Claude の実際の出力の記録で、デモ用カルテの管理者アカウント（M1026）の依頼", () => {
    expect(rec.writer).toBe("claude");
    expect(rec.note).toContain("実際の出力の記録");
    expect(rec.profileId).toBe(profile.id);
    expect(profile.assets.some((a) => a.id === rec.assetId)).toBe(true);
    expect(rec.mitigation).toBe("M1026");
  });
  it("本文は番号つきの選択肢と返信の書き方を含み、番号は画面の返信欄と同じ順", () => {
    rec.question.choices.forEach((c, i) => {
      expect(rec.text).toContain(`${i + 1}. ${c.labelJa}`);
    });
    expect(rec.text).toContain("返信");
    expect(rec.text).toContain(rec.question.textJa);
  });
  it("選択肢と回答の対応は、サーバの質問表と同じ", () => {
    const asset = profile.assets.find((a) => a.id === rec.assetId);
    const q = questionFor(rec.mitigation, asset?.role);
    expect(rec.choiceMap).toEqual(
      q?.choices.map((c) => ({
        id: c.id,
        labelJa: c.labelJa,
        status: c.status,
        ...(c.attrs ? { attrs: c.attrs } : {}),
      })),
    );
    expect(rec.question.choices).toEqual(q?.choices.map((c) => ({ id: c.id, labelJa: c.labelJa })));
    // 番号 1 は「全 PC で共通」（ない）。場面 5 の storyboard が番号 1 を選ぶ
    expect(rec.choiceMap[0]?.status).toBe("absent");
  });
  it("返信の入力は、サーバの recordReply と同じ回答（判定への反映）になる", () => {
    const view = requestFromRecording(rec);
    expect(view.id).toBe(DEMO_REQUEST_ID);
    expect(view.answer).toBeUndefined();
    const store = new RequestStore({ now: () => new Date("2026-11-08T01:00:00Z") });
    const stored: StoredRequest = { ...view, choiceMap };
    store.add(stored);
    const input = {
      choice: "shared",
      repliedBy: "山田",
      receivedAt: "2026-11-08T00:30:00.000Z",
      enteredBy: "情シス担当",
    };
    const server = store.recordReply(stored.id, input)?.answer;
    expect(answerFromReply(rec, input)).toEqual(server);
    // 入力者が無いとき
    const store2 = new RequestStore({ now: () => new Date("2026-11-08T01:00:00Z") });
    store2.add({ ...view, choiceMap });
    const { enteredBy: _e, ...noEnterer } = input;
    expect(answerFromReply(rec, noEnterer)).toEqual(store2.recordReply(view.id, noEnterer)?.answer);
  });
  it("知らない選択肢や日時は回答にしない", () => {
    expect(
      answerFromReply(rec, {
        choice: "nope",
        repliedBy: "山田",
        receivedAt: "2026-11-08T00:00:00Z",
      }),
    ).toBeUndefined();
    expect(
      answerFromReply(rec, { choice: "shared", repliedBy: "山田", receivedAt: "いつか" }),
    ).toBeUndefined();
  });
  it("API キー・認証ヘッダを含まない", () => {
    expect(findSecretLike(raw)).toEqual([]);
    expect(findSecretLike("x-api-key: abc")).toEqual(["認証ヘッダ"]);
    expect(findSecretLike("sk-ant-api03-abcdefghijklmnop")).toEqual(["Anthropic のキー"]);
  });
});
