/**
 * 安全の実装をテストで固定する：
 * - ネットワークに出る経路は DNS（dns-node.ts）と crt.sh（safe-fetch.ts 経由）だけ
 * - ホスト名への HTTP/TLS/TCP 接続を行う API を import しない
 * - 所有確認なしの実行は拒否される（ownership.test.ts）
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { packageRoot } from "./cache.ts";

const srcDir = join(packageRoot, "src");
const sources = readdirSync(srcDir)
  .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
  .map((f) => ({ file: f, text: readFileSync(join(srcDir, f), "utf8") }));

const FORBIDDEN_MODULES = [
  "node:http",
  "node:https",
  "node:net",
  "node:tls",
  "node:http2",
  "node:dgram",
  "node:child_process",
  '"http"',
  '"https"',
  '"net"',
  '"tls"',
  '"child_process"',
];

describe("ネットワークに出る経路", () => {
  it("ソースを読めている", () => {
    expect(sources.length).toBeGreaterThan(8);
  });

  it("HTTP/TLS/TCP の接続やプロセス起動のモジュールを import しない", () => {
    for (const { file, text } of sources) {
      for (const mod of FORBIDDEN_MODULES) {
        expect(text, `${file} が ${mod} を import している`).not.toMatch(
          new RegExp(
            `from\\s+${mod.startsWith('"') ? mod : `"${mod}"`}|require\\(\\s*${mod.startsWith('"') ? mod : `"${mod}"`}`,
          ),
        );
      }
      expect(text, `${file} が WebSocket を使っている`).not.toMatch(/\bnew WebSocket\b/);
    }
  });

  it("fetch を呼ぶのは proxy.ts（プロキシ対応の実装）と safe-fetch.ts（宛先の検査）だけ", () => {
    const allowed = new Set(["proxy.ts", "safe-fetch.ts"]);
    for (const { file, text } of sources) {
      if (allowed.has(file)) continue;
      expect(text, `${file} が fetch を直接呼んでいる`).not.toMatch(/\bfetch\s*\(/);
      expect(text, `${file} が undici を使っている`).not.toMatch(/from\s+"undici"/);
    }
  });

  it("safe-fetch.ts は fetch を呼ぶ前に assertAllowedUrl を通す", () => {
    const text = sources.find((s) => s.file === "safe-fetch.ts")?.text ?? "";
    const assertAt = text.indexOf("const url = assertAllowedUrl(input);");
    const fetchAt = text.indexOf("return base(url,");
    expect(assertAt).toBeGreaterThan(-1);
    expect(fetchAt).toBeGreaterThan(assertAt);
    expect(text).toContain('redirect: "error"');
  });

  it("DNS を直接使うのは dns-node.ts だけ", () => {
    for (const { file, text } of sources) {
      if (file === "dns-node.ts") continue;
      expect(text, `${file} が node:dns を使っている`).not.toMatch(/from\s+"node:dns/);
    }
  });

  it("recon は所有確認（assertVerified）を入口で呼ぶ", () => {
    const text = sources.find((s) => s.file === "recon.ts")?.text ?? "";
    const fn = text.indexOf("export async function recon(");
    const assertAt = text.indexOf("assertVerified(domain, options.ownership)", fn);
    const firstAwait = text.indexOf("await ", fn);
    expect(assertAt).toBeGreaterThan(fn);
    expect(assertAt).toBeLessThan(firstAwait);
  });
});

describe("Node の型ストリップで直接実行できる（S3 の API が node で動かすため）", () => {
  it("コンストラクタのパラメータプロパティなど、strip-only で落ちる構文を使わない", () => {
    for (const { file, text } of sources) {
      expect(text, `${file} がパラメータプロパティを使っている`).not.toMatch(
        /constructor\(\s*(private|public|protected|readonly)\b/,
      );
      expect(text, `${file} が enum を使っている`).not.toMatch(/^\s*(export\s+)?enum\s/m);
      expect(text, `${file} が namespace を使っている`).not.toMatch(/^\s*(export\s+)?namespace\s/m);
    }
  });
});
