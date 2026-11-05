import { isAbsolute, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { dataDirFrom, defaultDataDir } from "./data-dir.ts";
import { defaultKevFile } from "./routes/kev.ts";
import { defaultTokenFile } from "./routes/recon.ts";
import { defaultStoreFile } from "./routes/requests.ts";

describe("dataDirFrom（保存先の決め方）", () => {
  it("環境変数が無ければ従来どおり apps/web/.data", () => {
    expect(dataDirFrom({})).toBe(defaultDataDir);
    expect(defaultDataDir.endsWith(join("apps", "web", ".data"))).toBe(true);
  });
  it("空や空白だけなら従来の置き場にする", () => {
    expect(dataDirFrom({ UCHIDAI_DATA_DIR: "" })).toBe(defaultDataDir);
    expect(dataDirFrom({ UCHIDAI_DATA_DIR: "   " })).toBe(defaultDataDir);
  });
  it("UCHIDAI_DATA_DIR があればその場所（相対パスは絶対にする）", () => {
    const abs = resolve("/tmp/uchidai-data");
    expect(dataDirFrom({ UCHIDAI_DATA_DIR: abs })).toBe(abs);
    const rel = dataDirFrom({ UCHIDAI_DATA_DIR: "some/where" });
    expect(isAbsolute(rel)).toBe(true);
    expect(rel).toBe(resolve("some/where"));
  });
});

describe("既定の保存先（環境変数なしの従来の挙動）", () => {
  it("確認依頼・所有確認のトークン・KEV は apps/web/.data の下", () => {
    expect(defaultStoreFile).toBe(join(defaultDataDir, "requests.json"));
    expect(defaultTokenFile).toBe(join(defaultDataDir, "recon-tokens.json"));
    expect(defaultKevFile).toBe(join(defaultDataDir, "kev.json"));
  });
});
