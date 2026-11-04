/**
 * 安全の実装をテストで固定する：
 * - ネットワークに出る経路は DNS（dns-node.ts）と、証明書の公開ログ（crt.sh、予備の Cert Spotter。safe-fetch.ts 経由）だけ
 * - ホスト名への HTTP/TLS/TCP 接続を行う API を import しない。動的 import、require、eval も使わない
 * - 所有確認なしの実行は拒否される（ownership.test.ts）
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { packageRoot } from "./cache.ts";

const srcDir = join(packageRoot, "src");

/** 行頭のコメント（// と /** … *\/）を除く。文字列中の // は残すため、行頭以外は触らない */
function stripComments(text: string): string {
  return text
    .replace(/^\s*\/\*[\s\S]*?\*\//gm, "")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join("\n");
}

const sources = readdirSync(srcDir)
  .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
  .map((f) => {
    const raw = readFileSync(join(srcDir, f), "utf8");
    return { file: f, raw, text: stripComments(raw) };
  });

/** import してよいモジュール。ファイルごとの例外は右の表 */
const ALLOWED_IMPORTS = new Set([
  "zod",
  "@uchidai/engine",
  "node:crypto",
  "node:fs",
  "node:fs/promises",
  "node:path",
  "node:url",
]);
const ALLOWED_IMPORTS_BY_FILE: Record<string, string[]> = {
  "proxy.ts": ["undici"],
  "dns-node.ts": ["node:dns/promises"],
};

function importSpecifiers(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/(?:import|export)\s+(?:[^"'`;]*?\s+from\s+)?["']([^"']+)["']/g)) {
    if (m[1]) out.push(m[1]);
  }
  return out;
}

describe("ネットワークに出る経路", () => {
  it("ソースを読めている", () => {
    expect(sources.length).toBeGreaterThan(8);
  });

  it("import できるのは許可した標準モジュール・zod・engine と、相対パスだけ", () => {
    for (const { file, text } of sources) {
      const extra = new Set(ALLOWED_IMPORTS_BY_FILE[file] ?? []);
      for (const spec of importSpecifiers(text)) {
        if (spec.startsWith("./")) continue;
        expect(
          ALLOWED_IMPORTS.has(spec) || extra.has(spec),
          `${file} が許可外のモジュール ${spec} を import している`,
        ).toBe(true);
      }
    }
  });

  it("動的 import・require・eval・new Function・process.binding・globalThis を使わない", () => {
    for (const { file, text } of sources) {
      expect(text, `${file} が動的 import を使っている`).not.toMatch(/\bimport\s*\(/);
      expect(text, `${file} が require を使っている`).not.toMatch(/\brequire\s*\(/);
      expect(text, `${file} が eval を使っている`).not.toMatch(/\beval\s*\(/);
      expect(text, `${file} が new Function を使っている`).not.toMatch(/\bnew\s+Function\b/);
      expect(text, `${file} が process.binding を使っている`).not.toMatch(/process\.binding/);
      expect(text, `${file} が globalThis／window／self を参照している`).not.toMatch(
        /\b(globalThis|window|self)\s*[.[]/,
      );
      expect(text, `${file} が WebSocket／EventSource／XMLHttpRequest を使っている`).not.toMatch(
        /\b(WebSocket|EventSource|XMLHttpRequest)\b/,
      );
      expect(text, `${file} が worker や vm を使っている`).not.toMatch(
        /\b(Worker|node:vm|node:worker_threads)\b/,
      );
    }
  });

  it("fetch という識別子が出てくるのは proxy.ts と safe-fetch.ts だけ（別名への代入も含めて）", () => {
    const allowed = new Set(["proxy.ts", "safe-fetch.ts"]);
    for (const { file, text } of sources) {
      if (allowed.has(file)) continue;
      // オプション名（fetch?: …、fetch: …）とプロパティ参照（options.fetch）は許す。識別子としての fetch は不可
      expect(text, `${file} が fetch を直接使っている`).not.toMatch(
        /(?<![.\w-])fetch\b(?!\s*[?:])/,
      );
    }
  });

  it("safe-fetch.ts は fetch を呼ぶ前に assertAllowedUrl を通し、リダイレクトを追わない", () => {
    const text = sources.find((s) => s.file === "safe-fetch.ts")?.text ?? "";
    const assertAt = text.indexOf("const url = assertAllowedUrl(input);");
    const fetchAt = text.indexOf("return base(url,");
    expect(assertAt).toBeGreaterThan(-1);
    expect(fetchAt).toBeGreaterThan(assertAt);
    expect(text).toContain('redirect: "error"');
    expect(text).toContain('method: "GET"');
  });

  it("recon は所有確認（assertVerified）を最初の await より前に呼ぶ", () => {
    const text = sources.find((s) => s.file === "recon.ts")?.text ?? "";
    const fn = text.indexOf("export async function recon(");
    const assertAt = text.indexOf("assertVerified(domain, options.ownership", fn);
    const firstAwait = text.indexOf("await ", fn);
    expect(assertAt).toBeGreaterThan(fn);
    expect(assertAt).toBeLessThan(firstAwait);
  });

  it("CT から得た名前は、ホスト名の検証（isLookupSafeName）を通してから DNS に問い合わせる", () => {
    const text = sources.find((s) => s.file === "recon.ts")?.text ?? "";
    const check = text.indexOf("if (!isLookupSafeName(entry.name))");
    const lookup = text.indexOf("resolver.resolve4(entry.name)");
    expect(check).toBeGreaterThan(-1);
    expect(lookup).toBeGreaterThan(check);
  });
});

describe("Node の型ストリップで直接実行できる（S3 の API が node で動かすため）", () => {
  it("コンストラクタのパラメータプロパティなど、strip-only で落ちる構文を使わない", () => {
    for (const { file, raw } of sources) {
      expect(raw, `${file} がパラメータプロパティを使っている`).not.toMatch(
        /constructor\(\s*(private|public|protected|readonly)\b/,
      );
      expect(raw, `${file} が enum を使っている`).not.toMatch(/^\s*(export\s+)?enum\s/m);
      expect(raw, `${file} が namespace を使っている`).not.toMatch(/^\s*(export\s+)?namespace\s/m);
    }
  });
});
