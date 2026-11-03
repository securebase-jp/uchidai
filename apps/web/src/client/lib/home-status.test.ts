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
    expect(steps[3]?.statusJa).toBe("事例がまだありません");
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
    expect(example[1]?.statusJa).toContain("架空の会社");
    expect(example[1]?.statusJa).toContain("自社のカルテではありません");
    // 架空の会社は未確認があっても登録を促さない
    expect(example[2]?.tone).toBe("done");
    expect(example[2]?.statusJa).toContain("登録は要りません");
  });

  it("事例：記録済みか Claude の読解かを示し、カルテと揃えば 5 が押せる", () => {
    const recorded = homeSteps({
      ...empty,
      theCase: { title: "VPN から侵入", recordedId: "ipa-case-1" },
    });
    expect(recorded[3]?.statusJa).toBe("いまの事例：VPN から侵入（記録済みの読解結果）");
    expect(recorded[4]?.disabled).toBe(true);
    expect(recorded[4]?.statusJa).toBe("カルテができると見られます");

    const both = homeSteps({
      ...empty,
      profile: { companyName: "A", fictional: false, pending: 0 },
      profileSource: "answers",
      theCase: { title: "ある記事" },
    });
    expect(both[3]?.statusJa).toBe("いまの事例：ある記事（Claude が読解）");
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

  it("4：担当者が選んでいない既定の事例も「記録済みの事例 1 を使用中」で「未」にしない。選んだ事例は「いまの事例」", () => {
    const byDefault = homeSteps({
      ...empty,
      theCase: { title: "VPN の事例", recordedId: "ipa-case-1", chosen: false },
    })[3];
    expect(byDefault?.tone).toBe("done");
    expect(byDefault?.statusJa).toBe("記録済みの事例 1 を使用中：VPN の事例");
    expect(byDefault?.noteJa).toContain("既定の事例");
    const chosen = homeSteps({
      ...empty,
      theCase: { title: "VPN の事例", recordedId: "ipa-case-1", chosen: true },
    })[3];
    expect(chosen?.tone).toBe("done");
    expect(chosen?.statusJa).toBe("いまの事例：VPN の事例（記録済みの読解結果）");
    const read = homeSteps({ ...empty, theCase: { title: "報道の事例" } })[3];
    expect(read?.statusJa).toBe("いまの事例：報道の事例（Claude が読解）");
  });
});
