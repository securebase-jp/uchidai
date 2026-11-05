import { describe, expect, it } from "vitest";
import { focusOutbox, outboxHash, outboxKey, parseOutboxParam } from "./outbox-focus.ts";

describe("outbox-focus（札から送信箱へ）", () => {
  it("ハッシュに資産と対策を載せ、読み戻せる", () => {
    expect(outboxHash("admin", "M1026")).toBe("/staff?outbox=admin%3AM1026");
    expect(parseOutboxParam(`#${outboxHash("admin", "M1026")}`)).toBe(outboxKey("admin", "M1026"));
  });
  it("outbox が無い・空のハッシュは undefined", () => {
    expect(parseOutboxParam("#/staff")).toBeUndefined();
    expect(parseOutboxParam("#/staff?outbox=")).toBeUndefined();
    expect(parseOutboxParam("#/onepager?case=x")).toBeUndefined();
  });
});

type Fake = {
  dataset: Record<string, string>;
  classList: { add(c: string): void; remove(c: string): void };
  scrolled?: ScrollIntoViewOptions;
  scrollIntoView(o: ScrollIntoViewOptions): void;
  hit: Set<string>;
};
const fake = (key?: string): Fake => {
  const hit = new Set<string>();
  const f: Fake = {
    dataset: key ? { outboxKey: key } : {},
    classList: { add: (c) => void hit.add(c), remove: (c) => void hit.delete(c) },
    scrollIntoView: (o) => {
      f.scrolled = o;
    },
    hit,
  };
  return f;
};
const rootOf = (items: Fake[], box?: Fake) =>
  ({
    querySelectorAll: () => items,
    querySelector: (sel: string) => (sel === "[data-outbox-box]" ? box : undefined),
  }) as unknown as ParentNode;

describe("focusOutbox", () => {
  it("該当の依頼まで移動して、枠の印（クラス）を付ける", () => {
    const a = fake("admin:M1026");
    const b = fake("vpn:M1032");
    const box = fake();
    const got = focusOutbox("vpn:M1032", rootOf([a, b], box));
    expect(got).toBe(b);
    expect(b.hit.has("outbox-hit")).toBe(true);
    expect(a.hit.size).toBe(0);
    expect(b.scrolled).toBeDefined();
    expect(box.scrolled).toBeUndefined();
  });
  it("依頼が無い（0 件・回答済みなど）ときは、パネルの先頭へ移動し、壊れない", () => {
    const box = fake();
    expect(focusOutbox("admin:M1026", rootOf([], box))).toBeUndefined();
    expect(box.scrolled).toMatchObject({ block: "start" });
    expect(() => focusOutbox("x:y", rootOf([]))).not.toThrow();
  });
  it("動きを減らす設定のときは、滑らかに動かさない", () => {
    const g = globalThis as { document?: unknown };
    const prev = g.document;
    g.document = { documentElement: { dataset: { reduced: "true" } } };
    try {
      const a = fake("admin:M1026");
      focusOutbox("admin:M1026", rootOf([a]));
      expect(a.scrolled?.behavior).toBe("auto");
    } finally {
      g.document = prev;
    }
  });
});
