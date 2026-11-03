import { describe, expect, it } from "vitest";
import { wrapLabel } from "./labels.ts";

describe("wrapLabel", () => {
  it("短い名前はそのまま 1 行", () => {
    expect(wrapLabel("VPN装置")).toEqual(["VPN装置"]);
    expect(wrapLabel("クラウドメール")).toEqual(["クラウドメール"]);
    expect(wrapLabel("社員PC（約120台）")).toEqual(["社員PC"]);
  });
  it("括弧以降は落とす", () => {
    expect(wrapLabel("バックアップ（クラウド同期）")).toEqual(["バックアップ"]);
    expect(wrapLabel("会計 (クラウド)")).toEqual(["会計"]);
  });
  it("自然な位置で 2 行に折り返し、省略しない（デモ精工の資産名）", () => {
    expect(wrapLabel("保守用リモート接続")).toEqual(["保守用", "リモート接続"]);
    expect(wrapLabel("管理者アカウント")).toEqual(["管理者", "アカウント"]);
    expect(wrapLabel("生産管理システム（社内サーバ）")).toEqual(["生産管理", "システム"]);
    expect(wrapLabel("社長のメールアカウント")).toEqual(["社長のメール", "アカウント"]);
    expect(wrapLabel("クラウドストレージ（取引先とのデータ共有）")).toEqual([
      "クラウド",
      "ストレージ",
    ]);
    expect(wrapLabel("旧キャンペーンサイト（廃止済み）")).toEqual(["旧キャンペーン", "サイト"]);
  });
  it("5 問から作るカルテの資産名", () => {
    expect(wrapLabel("保守ベンダーの遠隔接続")).toEqual(["保守ベンダーの", "遠隔接続"]);
    expect(wrapLabel("公開ホームページ")).toEqual(["公開", "ホームページ"]);
    expect(wrapLabel("リモートデスクトップ")).toEqual(["リモート", "デスクトップ"]);
    expect(wrapLabel("販売管理システム")).toEqual(["販売管理", "システム"]);
  });
  it("業務と経営は 1 行の文字数が違う", () => {
    expect(wrapLabel("受注・生産管理", 8)).toEqual(["受注・生産管理"]);
    expect(wrapLabel("取引先とのデータ共有", 8)).toEqual(["取引先との", "データ共有"]);
    expect(wrapLabel("個人情報保護委員会への報告", 12)).toEqual(["個人情報保護", "委員会への報告"]);
  });
  it("自然な切れ目が無ければ文字数で切り、14 文字までは省略しない", () => {
    expect(wrapLabel("あいうえおかきくけこ")).toEqual(["あいうえお", "かきくけこ"]);
    expect(wrapLabel("あいうえおかきくけこさしすせ")).toEqual(["あいうえおかき", "くけこさしすせ"]);
  });
  it("15 文字を超えるときだけ末尾を「…」にする", () => {
    expect(wrapLabel("あいうえおかきくけこさしすせそ")).toEqual([
      "あいうえおかき",
      "くけこさしす…",
    ]);
    expect(wrapLabel("取引先の在庫管理システムの予備機")).toEqual(["取引先の", "在庫管理シス…"]);
  });
});
