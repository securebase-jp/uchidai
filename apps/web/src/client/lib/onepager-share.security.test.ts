/**
 * v0.1.4 前のセキュリティ診断（docs/security-review-v0.1.4-2026-11-07.md）：共有リンクの差分（v0.1.3 → main では resultWordJa が増えた）。
 * 改ざんしたリンクを手で作って開き、新しい項目にも長さの上限が掛かることと、タグ状の文字列が「ただの文字列」として通る（描画側が
 * React の文字として出す）ことを固定する。dangerouslySetInnerHTML・innerHTML は apps/web/src に無い（下の試験で数える）
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { app } from "../../server/app.ts";
import type { OnePagerResponse } from "./api.ts";
import { decodeShare, LIMITS, sharePayloadFrom, toBase64Url } from "./onepager-share.ts";

// biome-ignore lint/suspicious/noExplicitAny: テストでは応答の形を緩く読む
type Loose = any;

async function payload() {
  const c = (await (await app.request("/api/case/recorded/ipa-case-1")).json()) as Loose;
  const p = (await (await app.request("/api/examples/demo-seiko")).json()) as Loose;
  const res = await app.request("/api/onepager", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ case: c.case, profile: p.profile, measureIds: [], rewrite: false }),
  });
  return sharePayloadFrom((await res.json()) as OnePagerResponse);
}
const encodeRaw = async (value: unknown) => {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const piped = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new CompressionStream("deflate"));
  return toBase64Url(new Uint8Array(await new Response(piped).arrayBuffer()));
};

describe("共有リンク：改ざんした resultWordJa", () => {
  it("上限（300 字）を超える結論の語は項目名つきで断る", async () => {
    const p = await payload();
    const r = await decodeShare(
      await encodeRaw({
        ...p,
        onePager: { ...p.onePager, resultWordJa: "あ".repeat(LIMITS.title + 1) },
      }),
    );
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reasonJa).toContain("結論の語");
  });
  it("文字列でない結論の語（オブジェクトなど）は断る", async () => {
    const p = await payload();
    const r = await decodeShare(
      await encodeRaw({ ...p, onePager: { ...p.onePager, resultWordJa: { $html: "<b>" } } }),
    );
    expect(r.ok).toBe(false);
  });
  it("タグ状の文字列は、上限内ならただの文字列として通る（描画は React の文字。HTML としては解釈されない）", async () => {
    const p = await payload();
    const word = '<img src=x onerror="alert(1)">';
    const r = await decodeShare(
      await encodeRaw({ ...p, onePager: { ...p.onePager, resultWordJa: word } }),
    );
    expect(r.ok && r.payload.onePager.resultWordJa).toBe(word);
  });
});

describe("画面のコードに HTML を直接書き込む経路が無い", () => {
  it("dangerouslySetInnerHTML・innerHTML・outerHTML・insertAdjacentHTML・document.write を使っていない", () => {
    const root = join(__dirname, "..", "..");
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
          const text = readFileSync(path, "utf8");
          if (
            /dangerouslySetInnerHTML|\.innerHTML|\.outerHTML|insertAdjacentHTML|document\.write/.test(
              text,
            )
          )
            hits.push(path.slice(root.length));
        }
      }
    };
    walk(root);
    expect(hits).toEqual([]);
  });
});
