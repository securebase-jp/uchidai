import { describe, expect, it } from "vitest";
import { type HomeInput, homeSteps } from "./home-status.ts";

const fmt = (iso: string) => `日時(${iso})`;
const empty: HomeInput = {
  recon: undefined,
  profile: undefined,
  profileSource: undefined,
  theCase: undefined,
  formatDateTime: fmt,
};

describe("homeSteps（トップの 5 段と「いまの状態」）", () => {
  it("何も無いとき：1 は任意、2 はまだ、3 と 5 は押せない、4 は事例なし", () => {
    const steps = homeSteps(empty);
    expect(steps.map((s) => s.n)).toEqual([1, 2, 3, 4, 5]);
    expect(steps.map((s) => s.tone)).toEqual(["optional", "todo", "todo", "todo", "todo"]);
    expect(steps[0]?.statusJa).toBe("未実施");
    expect(steps[0]?.noteJa).toContain("任意");
    expect(steps[1]?.statusJa).toBe("まだ答えていません");
    expect(steps[2]?.disabled).toBe(true);
    expect(steps[3]?.statusJa).toBe("事例を選んでください");
    expect(steps[3]?.tone).toBe("todo");
    expect(steps[3]?.href).toBeUndefined();
    expect(steps[4]?.disabled).toBe(true);
    expect(steps[4]?.statusJa).toBe("カルテと事例が揃うと見られます");
  });

  it("外部確認：実ドメインは確認済み、架空のドメインは記録の再生と出す", () => {
    const real = homeSteps({
      ...empty,
      recon: { domain: "example.jp", fixture: false, checkedAt: "2026-11-03T00:00:00Z" },
    })[0];
    expect(real?.tone).toBe("done");
    expect(real?.statusJa).toBe("example.jp を確認済み（日時(2026-11-03T00:00:00Z)）");
    const fixture = homeSteps({
      ...empty,
      recon: { domain: "demo-seiko.example", fixture: true, checkedAt: "x" },
    })[0];
    expect(fixture?.statusJa).toContain("架空のドメイン demo-seiko.example の記録を再生");
  });

  it("カルテの出どころで 2 の文が変わり、3 は未確認の件数を出す", () => {
    const answers = homeSteps({
      ...empty,
      profile: { companyName: "テスト製作所", fictional: false, pending: 18 },
      profileSource: "answers",
    });
    expect(answers[1]?.statusJa).toBe("回答済み：テスト製作所");
    expect(answers[2]?.tone).toBe("warn");
    expect(answers[2]?.statusJa).toBe("未確認 18 件");
    expect(answers[2]?.noteJa).toContain("最悪の想定");
    expect(answers[2]?.disabled).toBeUndefined();

    const saved = homeSteps({
      ...empty,
      profile: { companyName: "テスト製作所", fictional: false, pending: 0 },
      profileSource: "saved",
    });
    expect(saved[1]?.statusJa).toContain("このブラウザに保存済み");
    expect(saved[2]?.tone).toBe("done");
    expect(saved[2]?.statusJa).toBe("未確認 0 件");

    const example = homeSteps({
      ...empty,
      profile: { companyName: "デモ精工株式会社", fictional: true, pending: 4 },
      profileSource: "example",
    });
    expect(example[1]?.statusJa).toBe("架空の会社：デモ精工株式会社（自社のカルテではありません）");
    // 架空の会社は未確認があっても登録を促さない
    expect(example[2]?.tone).toBe("done");
    expect(example[2]?.statusJa).toBe("架空の会社：デモ精工株式会社（登録は要りません）");
    // 自社のカルテ（保存）に戻すと従来どおり
    const back = homeSteps({
      ...empty,
      profile: { companyName: "テスト製作所", fictional: false, pending: 2 },
      profileSource: "saved",
    });
    expect(back[1]?.statusJa).toBe("このブラウザに保存済みのカルテ：テスト製作所");
    expect(back[2]?.statusJa).toBe("未確認 2 件");
  });

  it("事例：記録済みか Claude の読解かを示し、カルテと揃えば 5 が押せる", () => {
    const recorded = homeSteps({
      ...empty,
      theCase: { title: "VPN から侵入", recordedId: "ipa-case-1" },
    });
    expect(recorded[3]?.statusJa).toBe("記録済みの事例 1 を使用中：VPN から侵入");
    expect(recorded[4]?.disabled).toBe(true);
    expect(recorded[4]?.statusJa).toBe("カルテができると見られます");

    const both = homeSteps({
      ...empty,
      profile: { companyName: "A", fictional: false, pending: 0 },
      profileSource: "answers",
      theCase: { title: "ある記事" },
    });
    expect(both[3]?.statusJa).toBe("記事を使用中：ある記事");
    expect(both[4]?.tone).toBe("done");
    expect(both[4]?.disabled).toBeUndefined();
    expect(both[4]?.href).toBe("#/staff");

    const onlyProfile = homeSteps({
      ...empty,
      profile: { companyName: "A", fictional: false, pending: 0 },
      profileSource: "answers",
    });
    expect(onlyProfile[4]?.statusJa).toBe("事例を選ぶと見られます");
  });

  it("4：事例が空なら「事例を選んでください」（未）。選んだ事例は「記録済みの事例 N を使用中」か「記事を使用中」", () => {
    const none = homeSteps({ ...empty })[3];
    expect(none?.tone).toBe("todo");
    expect(none?.statusJa).toBe("事例を選んでください");
    const chosen = homeSteps({
      ...empty,
      theCase: { title: "VPN の事例", recordedId: "ipa-case-1", chosen: true },
    })[3];
    expect(chosen?.tone).toBe("done");
    expect(chosen?.statusJa).toBe("記録済みの事例 1 を使用中：VPN の事例");
    expect(chosen?.noteJa).toBeUndefined();
    const read = homeSteps({ ...empty, theCase: { title: "報道の事例", chosen: true } })[3];
    expect(read?.statusJa).toBe("記事を使用中：報道の事例");
  });

  it("4：デモ・録画の URL が読んだ既定の事例（chosen: false）は「未」にせず、既定の事例だと補足する", () => {
    const byDefault = homeSteps({
      ...empty,
      theCase: { title: "VPN の事例", recordedId: "ipa-case-1", chosen: false },
    })[3];
    expect(byDefault?.tone).toBe("done");
    expect(byDefault?.statusJa).toBe("記録済みの事例 1 を使用中：VPN の事例");
    expect(byDefault?.noteJa).toContain("既定の事例");
  });
});
