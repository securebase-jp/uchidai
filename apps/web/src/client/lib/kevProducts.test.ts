import { loadKevProducts, matchProduct } from "@uchidai/engine";
import { describe, expect, it } from "vitest";
import { matchProductId, versionHint } from "./kevProducts.ts";
import { kevProductOptions } from "./kevProductsData.ts";

describe("製品の選択肢（knowledge/kev/products.yaml）", () => {
  const table = loadKevProducts();
  it("サーバが読む表と同じ製品が、同じ順で並ぶ", () => {
    expect(kevProductOptions.map((p) => p.id)).toEqual(table.products.map((p) => p.id));
  });
  it("選んだ製品の名前（labelJa）を保存しても、サーバの突き合わせは同じ製品に当てる", () => {
    for (const p of kevProductOptions) {
      expect(matchProduct(p.labelJa, table)?.id, p.labelJa).toBe(p.id);
      expect(matchProductId(p.labelJa, kevProductOptions), p.labelJa).toBe(p.id);
    }
  });
  it("自由記述の製品名も、サーバと同じ製品に当てる（表記ゆれ、カタカナ、型番つき）", () => {
    for (const text of [
      "Fortinet FortiOS",
      "FortiGate 60F",
      "フォーティゲート",
      "Cisco ASA 5506-X",
      "SonicWall SMA 100",
      "SonicWall TZ370",
      "PAN-OS",
      "ヤマハ RTX1210",
      "Microsoft Exchange Server 2019",
    ]) {
      expect(matchProductId(text, kevProductOptions), text).toBe(matchProduct(text, table)?.id);
      expect(matchProductId(text, kevProductOptions), text).toBeDefined();
    }
  });
  it("一覧にない製品や空は当たらない（その他）", () => {
    expect(matchProductId("社内の自作ルータ", kevProductOptions)).toBeUndefined();
    expect(matchProductId("", kevProductOptions)).toBeUndefined();
    expect(matchProductId(undefined, kevProductOptions)).toBeUndefined();
  });
});

describe("versionHint（版の欄の placeholder と補足）", () => {
  it("例と補足を分ける", () => {
    expect(versionHint("例：7.0.14（FortiOS の版。装置の型番ではなくファームウェアの版）")).toEqual(
      {
        placeholder: "例：7.0.14",
        noteJa: "FortiOS の版。装置の型番ではなくファームウェアの版",
      },
    );
    expect(versionHint("例：22.7R2.4、9.1R18.9")).toEqual({
      placeholder: "例：22.7R2.4、9.1R18.9",
    });
  });
  it("無ければ既定の例", () => {
    expect(versionHint(undefined)).toEqual({ placeholder: "例：7.0.14" });
  });
  it("products.yaml の全製品で、例を読み取れる", () => {
    for (const p of kevProductOptions) {
      expect(versionHint(p.versionHintJa).placeholder.startsWith("例："), p.id).toBe(true);
    }
  });
});
