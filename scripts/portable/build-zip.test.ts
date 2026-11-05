import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  bareImports,
  collectRuntimePackages,
  isDroppable,
  parseArgs,
  shaFromSums,
  TARGETS,
} from "./build-zip.ts";

test("SHASUMS256.txt から、ファイル名に対応する値を取り出す", () => {
  const sums = `${"a".repeat(64)}  node-v22.0.0-win-x64.zip\n${"b".repeat(64)}  node-v22.0.0-linux-x64.tar.gz\n`;
  assert.equal(shaFromSums(sums, "node-v22.0.0-linux-x64.tar.gz"), "b".repeat(64));
  assert.equal(shaFromSums(sums, "node-v22.0.0-win-x64.zip"), "a".repeat(64));
  assert.equal(shaFromSums(sums, "missing.zip"), undefined);
});

test("同梱する Node の固定値は、4 つの環境ぶんそろっている", async () => {
  const { readFileSync } = await import("node:fs");
  const release = JSON.parse(readFileSync(new URL("./node-release.json", import.meta.url), "utf8"));
  assert.match(release.version, /^22\.\d+\.\d+$/);
  for (const target of TARGETS) {
    const entry = release.files[target];
    assert.match(entry.sha256, /^[0-9a-f]{64}$/, target);
    assert.ok(entry.file.includes(release.version), target);
  }
});

test("引数：all は 4 環境、版の v は外す、不正な値は拒む", () => {
  const a = parseArgs(["--target", "all", "--version", "v1.2.3", "--out", "/tmp/o"], {});
  assert.deepEqual(a.targets, [...TARGETS]);
  assert.equal(a.version, "1.2.3");
  assert.deepEqual(parseArgs(["--target", "win-x64,linux-x64", "--version", "0.1.0"], {}).targets, [
    "win-x64",
    "linux-x64",
  ]);
  assert.throws(() => parseArgs(["--target", "freebsd", "--version", "1.0.0"], {}), /target/);
  assert.throws(() => parseArgs(["--target", "all", "--version", "../x"], {}), /version/);
  assert.throws(() => parseArgs(["--target", "all"], {}), /version/);
});

test("import から外部パッケージ名を集める（相対、node:、@uchidai は除く。スコープつきは 2 つ目まで）", () => {
  const source = `
    import { a } from "./a.ts";
    import fs from "node:fs";
    import { serve } from "@hono/node-server";
    import { serveStatic } from "@hono/node-server/serve-static";
    import { cors } from "hono/cors";
    import type { X } from "zod";
    import { engine } from "@uchidai/engine";
    const { createTransport } = await import("nodemailer");
    export * from "yaml";
  `;
  assert.deepEqual([...bareImports(source)].sort(), [
    "@hono/node-server",
    "hono",
    "nodemailer",
    "yaml",
    "zod",
  ]);
});

test("依存のたどり方：入れ子の node_modules を優先し、任意の依存が無くても止まらず、必須が無ければ止まる", () => {
  const root = mkdtempSync(join(tmpdir(), "uchidai-deps-test-"));
  try {
    const pkg = (dir: string, json: object) => {
      mkdirSync(join(root, dir), { recursive: true });
      writeFileSync(join(root, dir, "package.json"), JSON.stringify(json));
    };
    pkg("node_modules/a", {
      name: "a",
      dependencies: { b: "1" },
      optionalDependencies: { native: "1" },
    });
    pkg("node_modules/b", { name: "b", dependencies: {} });
    pkg("node_modules/c", { name: "c", dependencies: { b: "2" } });
    pkg("node_modules/c/node_modules/b", { name: "b" });
    pkg("node_modules/unused", { name: "unused" });
    const dirs = collectRuntimePackages(root, ["a", "c"]).map((d) =>
      d.slice(root.length + 1).replaceAll("\\", "/"),
    );
    assert.deepEqual(dirs, [
      "node_modules/a",
      "node_modules/b",
      "node_modules/c",
      "node_modules/c/node_modules/b",
    ]);
    assert.throws(() => collectRuntimePackages(root, ["missing"]), /missing/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("実行に要らないファイルだけを落とす（ライセンス文は残す）", () => {
  for (const drop of [
    "index.d.ts",
    "dist/a.js.map",
    "README.md",
    "CHANGELOG.md",
    "src/a.test.ts",
    "tests/a.js",
    "__tests__/a.js",
    "docs/a.md",
    ".github/workflows/x.yml",
  ]) {
    assert.equal(isDroppable(drop), true, drop);
  }
  for (const keep of [
    "index.js",
    "dist/index.mjs",
    "LICENSE",
    "LICENSE.md",
    "LICENSE-MIT.txt",
    "NOTICE",
    "package.json",
    "lib/data.json",
  ]) {
    assert.equal(isDroppable(keep), false, keep);
  }
});
