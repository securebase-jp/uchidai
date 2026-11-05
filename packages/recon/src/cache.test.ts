import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultCacheDirFrom, packageRoot } from "./cache.ts";

describe("defaultCacheDirFrom（キャッシュの置き場）", () => {
  it("環境変数が無ければ従来どおり packages/recon/.cache", () => {
    expect(defaultCacheDirFrom({})).toBe(join(packageRoot, ".cache"));
    expect(defaultCacheDirFrom({ UCHIDAI_DATA_DIR: "  " })).toBe(join(packageRoot, ".cache"));
  });
  it("UCHIDAI_DATA_DIR があればその下の recon-cache", () => {
    expect(defaultCacheDirFrom({ UCHIDAI_DATA_DIR: "/tmp/uchidai-data" })).toBe(
      join(resolve("/tmp/uchidai-data"), "recon-cache"),
    );
  });
});
