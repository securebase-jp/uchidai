import { describe, expect, it } from "vitest";
import { eventSourceId, shortLabel } from "./timeline-view.ts";
import type { TimelineEvent } from "./types.ts";

const ev = (extra: Partial<TimelineEvent>): TimelineEvent => ({
  day: 0,
  kind: "business_stop",
  labelJa: "",
  ...extra,
});

describe("shortLabel / eventSourceId（時間軸の出来事）", () => {
  it("期限は短い語に、出典は法令・警察・BEC の期限にだけ付く（保険と取引先は会社カルテが根拠）", () => {
    const prompt = ev({
      kind: "legal",
      day: 5,
      deadlineId: "ppc-prompt",
      labelJa: "個人情報保護委員会へ速報（3〜5 日以内）",
    });
    expect(shortLabel(prompt)).toBe("委員会へ速報");
    expect(eventSourceId(prompt)).toBe("ppc-guidelines");
    expect(eventSourceId(ev({ deadlineId: "police", kind: "police" }))).toBe("npa-soudan");
    expect(eventSourceId(ev({ deadlineId: "bank-recall", kind: "money" }))).toBe("mpd-bec");
    expect(eventSourceId(ev({ deadlineId: "insurance", kind: "insurance" }))).toBeUndefined();
    expect(eventSourceId(ev({ deadlineId: "partner-notice", kind: "partner" }))).toBeUndefined();
    expect(eventSourceId(ev({ labelJa: "「受注・生産管理」が止まる" }))).toBeUndefined();
  });
  it("業務の停止・復旧・取引先への影響は業務名だけ残す", () => {
    expect(shortLabel(ev({ labelJa: "「受注・生産管理」が止まる" }))).toBe(
      "受注・生産管理が止まる",
    );
    expect(
      shortLabel(ev({ kind: "recovery", day: 10, labelJa: "「受注・生産管理」が復旧する" })),
    ).toBe("受注・生産管理が復旧");
    expect(
      shortLabel(ev({ kind: "partner", day: 3, labelJa: "3 日目から取引先の納期に影響" })),
    ).toBe("取引先に影響");
    expect(shortLabel(ev({ labelJa: "侵入され、社内のシステムが暗号化される" }))).toBe(
      "侵入・暗号化",
    );
    expect(shortLabel(ev({ kind: "money", labelJa: "なりすましの指示で送金してしまう" }))).toBe(
      "送金してしまう",
    );
    expect(shortLabel(ev({ kind: "legal", labelJa: "個人情報の流出が発覚する" }))).toBe(
      "流出が発覚",
    );
  });
});
