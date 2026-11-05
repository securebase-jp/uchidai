import { describe, expect, it } from "vitest";
import { readFlagsOf, readNotices } from "./read-notices.ts";

const step = { tactic: "TA0001", techniques: [], source: "stated" } as never;

describe("readNotices（読解の確認の文）", () => {
  it("out_of_scope で段階が 0 のときは、警告でなく「攻撃の記事ではないと判断しました」", () => {
    const n = readNotices({ damageType: "out_of_scope", steps: [] });
    expect(n).toEqual([
      { id: "out_of_scope", tone: "info", textJa: "攻撃の記事ではないと判断しました" },
    ]);
  });
  it("続報で種類が分からないとき（needsPrevious）は、「攻撃の記事ではない」と言わず、第一報と合わせて読むよう伝える", () => {
    const n = readNotices({ damageType: "out_of_scope", steps: [], needsPrevious: true });
    expect(n).toEqual([
      {
        id: "needs_previous",
        tone: "warn",
        textJa: "これは続報で、この文書だけでは種類が分かりません。第一報と合わせて読んでください",
      },
    ]);
  });
  it("攻撃の記事で段階があれば何も出さない。段階が 0 でも out_of_scope でなければ出さない（読めなかった警告は API 側）", () => {
    expect(readNotices({ damageType: "ransomware", steps: [step] })).toEqual([]);
    expect(readNotices({ damageType: "ransomware", steps: [] })).toEqual([]);
    expect(readNotices({ damageType: "out_of_scope", steps: [step] })).toEqual([]);
  });
  it("本文が切れていそうなときは、本文を貼って読める案内（入口への導線つき）", () => {
    const n = readNotices({ damageType: "ransomware", steps: [step] }, ["incomplete"]);
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({ id: "incomplete", tone: "warn", pasteLink: true });
    expect(n[0]?.textJa).toBe("続きが取得できていない可能性があります。本文を貼って読めます");
  });
  it("article の incomplete / truncated を保存する印にする", () => {
    expect(readFlagsOf({})).toEqual([]);
    expect(readFlagsOf({ incomplete: [] })).toEqual([]);
    expect(readFlagsOf({ incomplete: ["members_only"], truncated: true })).toEqual([
      "incomplete",
      "truncated",
    ]);
  });
});
