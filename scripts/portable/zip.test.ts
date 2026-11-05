import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { inspectZip } from "./inspect.ts";
import { readZipEntries, readZipEntryData, ZipWriter } from "./zip.ts";

function makeZip(files: Record<string, { data: string | Buffer; mode?: number }>): {
  zip: Buffer;
  entries: ReturnType<typeof readZipEntries>;
} {
  const dir = mkdtempSync(join(tmpdir(), "uchidai-zip-test-"));
  try {
    const path = join(dir, "t.zip");
    const writer = new ZipWriter(path, { mtime: new Date(2026, 10, 5, 12, 0, 0) });
    for (const [name, { data, mode }] of Object.entries(files)) {
      writer.addFile(name, typeof data === "string" ? Buffer.from(data, "utf8") : data, mode);
    }
    writer.finish();
    const zip = readFileSync(path);
    return { zip, entries: readZipEntries(zip) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("ZIP：日本語の名前、権限、圧縮の有無、中身が往復で変わらない", () => {
  const big = Buffer.from("ウチダイ".repeat(1000), "utf8");
  const random = Buffer.from(Array.from({ length: 256 }, (_, i) => (i * 37) % 256));
  const { zip, entries } = makeZip({
    "x/ウチダイを起動.command": { data: "#!/bin/bash\n", mode: 0o755 },
    "x/big.txt": { data: big },
    "x/random.bin": { data: random },
    "x/empty": { data: "" },
  });
  const byName = new Map(entries.map((e) => [e.name, e]));
  const launcher = byName.get("x/ウチダイを起動.command");
  assert.ok(launcher);
  assert.equal(launcher.mode & 0o777, 0o755);
  assert.equal(byName.get("x/big.txt")?.method, 8);
  assert.equal(byName.get("x/empty")?.size, 0);
  for (const e of entries) assert.ok(readZipEntryData(zip, e).length === e.size);
  const bigEntry = byName.get("x/big.txt");
  assert.ok(bigEntry);
  assert.deepEqual(readZipEntryData(zip, bigEntry), big);
  const randomEntry = byName.get("x/random.bin");
  assert.ok(randomEntry);
  assert.deepEqual(readZipEntryData(zip, randomEntry), random);
});

test("ZIP：同じ名前を 2 回入れると失敗する", () => {
  const dir = mkdtempSync(join(tmpdir(), "uchidai-zip-test-"));
  try {
    const writer = new ZipWriter(join(dir, "d.zip"), { mtime: new Date() });
    writer.addFile("a", Buffer.from("1"));
    assert.throws(() => writer.addFile("a", Buffer.from("2")), /同じ名前/);
    writer.finish();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("検査：.env 系、鍵、API キーらしき文字列、Windows で壊れる名前、テストを拒む", () => {
  const key = `sk-ant-api03-${"a".repeat(30)}`;
  const { zip, entries } = makeZip({
    "t/ok.txt": { data: "問題なし" },
    "t/uchidai.env.example": { data: "# ANTHROPIC_API_KEY=\n" },
    "t/.env": { data: "X=1" },
    "t/app/.env.local": { data: "X=1" },
    "t/uchidai.env": { data: "X=1" },
    "t/app/.data/requests.json": { data: "{}" },
    "t/app/demo/a.txt": { data: "x" },
    "t/leak.txt": { data: `token ${key}` },
    "t/env.txt": { data: "ANTHROPIC_API_KEY=abc123\n" },
    "t/key.pem": { data: "x" },
    "t/a.test.ts": { data: "x" },
    "t/CON.txt": { data: "x" },
    "t/trail.": { data: "x" },
    "t/Case.txt": { data: "x" },
    "t/case.txt": { data: "x" },
    "outside.txt": { data: "x" },
  });
  const { problems } = inspectZip(zip, entries, { topDir: "t" });
  const flagged = new Set(problems.map((p) => p.path));
  for (const expected of [
    ".env",
    "app/.env.local",
    "uchidai.env",
    "app/.data/requests.json",
    "app/demo/a.txt",
    "leak.txt",
    "env.txt",
    "key.pem",
    "a.test.ts",
    "CON.txt",
    "trail.",
    "case.txt",
    "outside.txt",
  ]) {
    assert.ok(flagged.has(expected), `${expected} を検出できない`);
  }
  assert.equal(flagged.has("ok.txt"), false);
  assert.equal(flagged.has("uchidai.env.example"), false, "コメントだけの見本は通す");
  // 出力に秘密の値は含めない
  assert.equal(JSON.stringify(problems).includes(key), false);
});

test("検査：環境変数の実際の値と同じ文字列は、形に関わらず拒む（値は出力しない）", () => {
  const secret = "very-secret-value-12345";
  const { zip, entries } = makeZip({
    "t/a.txt": { data: `x ${secret} y` },
    "t/b.bin": { data: Buffer.concat([Buffer.from([0]), Buffer.from(secret)]) },
  });
  const { problems } = inspectZip(zip, entries, { topDir: "t", secretValues: [secret] });
  assert.deepEqual(problems.map((p) => p.path).sort(), ["a.txt", "b.bin"]);
  assert.equal(JSON.stringify(problems).includes(secret), false);
});

test("検査：問題が無ければ空。相対パスが長すぎると指摘する", () => {
  const { zip, entries } = makeZip({
    "t/a.txt": { data: "x" },
    [`t/${"d/".repeat(60)}f.txt`]: { data: "x" },
  });
  const { problems, files } = inspectZip(zip, entries, { topDir: "t", maxRelativePath: 100 });
  assert.equal(files, 2);
  assert.equal(problems.length, 1);
  assert.match(problems[0]?.why ?? "", /文字を超える/);
});
