import { describe, expect, it } from "vitest";
import { requestsAutoOpen, staffCounts } from "./staff-status.ts";

const open = {} as never;
const done = { answer: { input: {} } } as never;

describe("staffCounts", () => {
  it("未確認は渡された件数、依頼済みは answer のない依頼、回答ありは answer のある依頼を数える", () => {
    expect(staffCounts(3, [open, open, done])).toEqual({ pending: 3, waiting: 2, answered: 1 });
  });
  it("依頼が無ければ 0 件", () => {
    expect(staffCounts(0, [])).toEqual({ pending: 0, waiting: 0, answered: 0 });
  });
});

describe("requestsAutoOpen（確認依頼を自動で開く条件）", () => {
  it("未確認がある・回答待ちがある・回答ありがあるときは開く", () => {
    expect(requestsAutoOpen({ pending: 1, waiting: 0, answered: 0 })).toBe(true);
    expect(requestsAutoOpen({ pending: 0, waiting: 1, answered: 0 })).toBe(true);
    expect(requestsAutoOpen({ pending: 0, waiting: 0, answered: 1 })).toBe(true);
  });
  it("何も無ければ閉じる", () => {
    expect(requestsAutoOpen({ pending: 0, waiting: 0, answered: 0 })).toBe(false);
  });
});
