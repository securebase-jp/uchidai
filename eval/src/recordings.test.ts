/**
 * 記録（eval/recordings、packages/llm/src/fixtures）の健全性：形、model と recordedAt、
 * リクエストヘッダ・API キー・個人情報が入っていないこと
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RecordingSchema } from "./types.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const recordingsDir = join(here, "..", "recordings");
const fixturesDir = join(root, "packages", "llm", "src", "fixtures");

function jsonFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return jsonFiles(p);
    return f.endsWith(".json") ? [p] : [];
  });
}

const FORBIDDEN: [string, RegExp][] = [
  ["API キー", /sk-ant-[\w-]{10,}/],
  [
    "リクエストヘッダ",
    /"(x-api-key|authorization|anthropic-version|anthropic-beta|user-agent)"\s*:/i,
  ],
  ["メールアドレス（example.com 以外）", /[\w.+-]+@(?!example\.(com|net|org)\b)[\w-]+\.[\w.-]+/],
  ["IPv4 アドレス", /\b(?!0\.0\.0\.0)\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/],
  ["電話番号", /0\d{1,4}-\d{1,4}-\d{4}/],
];

describe("記録と fixture", () => {
  const files = [...jsonFiles(recordingsDir), ...jsonFiles(fixturesDir)];
  it("対象のファイルがある", () => {
    expect(files.length).toBeGreaterThan(10);
  });
  it("ヘッダ・キー・個人情報らしき文字列を含まない", () => {
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      for (const [label, re] of FORBIDDEN) expect(text, `${f}: ${label}`).not.toMatch(re);
    }
  });
  it("Claude の応答の記録には model と recordedAt がある", () => {
    for (const f of files) {
      const d = JSON.parse(readFileSync(f, "utf8")) as Record<string, unknown>;
      if (f.endsWith("raw-case-vpn.json")) continue; // 手書きの検証用入力（Claude の応答ではない）
      expect(typeof d.recordedAt, f).toBe("string");
      const model = d.model ?? (d.vendorRequest as { output?: { model?: string } })?.output?.model;
      expect(typeof model, f).toBe("string");
    }
  });
  it("読解の記録は RecordingSchema に従い、3 値（記載／推定／不明）の範囲に収まる", () => {
    for (const f of jsonFiles(recordingsDir).filter((p) =>
      /\.(with|without)-knowledge\.json$/.test(p),
    )) {
      const rec = RecordingSchema.parse(JSON.parse(readFileSync(f, "utf8")));
      expect(rec.model).toMatch(/^claude-/);
      expect(rec.attackVersion).toBeDefined();
      for (const s of rec.output.steps)
        expect(["stated", "inferred", "unknown"]).toContain(s.source);
      // 根拠文があるのは stated の段階だけ
      for (const s of rec.output.steps) if (s.quote) expect(s.source, f).toBe("stated");
    }
  });
});
