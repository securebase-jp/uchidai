import { describe, expect, it } from "vitest";
import { app } from "../../server/app.ts";
import type { OnePagerResponse } from "./api.ts";
import {
  BASE64URL,
  buildShareHash,
  decodeShare,
  encodeShare,
  fromBase64Url,
  InflateTooLargeError,
  inflateLimited,
  LIMITS,
  MAX_INFLATED_BYTES,
  MAX_SHARE_CHARS,
  SHARE_VERSION,
  sharePayloadFrom,
  shareSizeNoteJa,
  supportsShare,
  toBase64Url,
} from "./onepager-share.ts";

// biome-ignore lint/suspicious/noExplicitAny: テストでは応答の形を緩く読む
type Loose = any;
const loose = async (res: Response | Promise<Response>): Promise<Loose> => (await res).json();
const post = (path: string, body: unknown) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

/** 架空企業 × 事例 1 の一枚を API（engine）から作る。共有リンクの写しのスキーマが engine の出力を受け付けることも確かめる */
async function onePagerResponse(measureIds: string[] = []): Promise<OnePagerResponse> {
  const c = await loose(app.request("/api/case/recorded/ipa-case-1"));
  const p = await loose(app.request("/api/examples/demo-seiko"));
  const res = await post("/api/onepager", {
    case: c.case,
    profile: p.profile,
    measureIds,
    rewrite: false,
  });
  expect(res.status).toBe(200);
  return (await res.json()) as OnePagerResponse;
}

describe("共有リンク（圧縮 → base64url → 展開 → zod）", () => {
  it("この実行環境に CompressionStream がある", () => {
    expect(supportsShare()).toBe(true);
  });

  it("engine の一枚を往復させると同じ内容になり、URL は数 KB に収まる", async () => {
    const data = await onePagerResponse(["vpn-update"]);
    const now = new Date("2026-11-03T09:00:00+09:00");
    const payload = sharePayloadFrom(data, now);
    expect(payload.v).toBe(SHARE_VERSION);
    expect(payload.appliedJa).toEqual(["VPN 装置の更新"]);
    expect(payload.attackVersion).toBe(data.verdict.attackVersion);
    expect(payload.generatedAt).toBe(now.toISOString());

    const d = await encodeShare(payload);
    expect(d).toMatch(BASE64URL);
    expect(d.length).toBeGreaterThan(100);
    expect(d.length).toBeLessThan(8000);
    expect(buildShareHash(d)).toBe(`#/onepager?d=${d}`);

    const back = await decodeShare(d);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.payload).toEqual(payload);
    expect(back.payload.onePager).toEqual(data.onePager);
    expect(back.payload.onePager.result).toBe("blocked");
  });

  it("対策なしの一枚（大丈夫ではない）も往復できる", async () => {
    const data = await onePagerResponse();
    const d = await encodeShare(sharePayloadFrom(data));
    const back = await decodeShare(d);
    expect(back.ok && back.payload.onePager.result).toBe("breached");
    expect(back.ok && back.payload.appliedJa).toEqual([]);
  });

  it("壊れたリンクは落ちずに日本語の理由を返す", async () => {
    const bad = (r: Awaited<ReturnType<typeof decodeShare>>) => (r.ok ? "" : r.reasonJa);
    expect(bad(await decodeShare(""))).toContain("壊れています");
    expect(bad(await decodeShare("あいう"))).toContain("壊れています");
    expect(bad(await decodeShare("not+base64url/"))).toContain("壊れています");
    // 形は正しいが deflate ではない
    expect(bad(await decodeShare(toBase64Url(new TextEncoder().encode("plain"))))).toContain(
      "展開できません",
    );
    // 途中で切れたリンク
    const data = await onePagerResponse();
    const d = await encodeShare(sharePayloadFrom(data));
    const cut = await decodeShare(d.slice(0, Math.floor(d.length / 2)));
    expect(cut.ok).toBe(false);
  });

  it("JSON でない内容、違う版、形の違う内容は理由を分けて返す", async () => {
    const encodeRaw = async (text: string) => {
      const bytes = new TextEncoder().encode(text);
      const piped = new Blob([bytes as BlobPart])
        .stream()
        .pipeThrough(new CompressionStream("deflate"));
      return toBase64Url(new Uint8Array(await new Response(piped).arrayBuffer()));
    };
    const notJson = await decodeShare(await encodeRaw("{broken"));
    expect(!notJson.ok && notJson.reasonJa).toContain("JSON");
    const otherVersion = await decodeShare(await encodeRaw(JSON.stringify({ v: 99 })));
    expect(!otherVersion.ok && otherVersion.reasonJa).toContain("v=99");
    const wrongShape = await decodeShare(
      await encodeRaw(JSON.stringify({ v: 1, onePager: { companyName: 1 } })),
    );
    expect(!wrongShape.ok && wrongShape.reasonJa).toContain("形が違います");
    expect(!wrongShape.ok && wrongShape.reasonJa).toContain("onePager");
    // 知らない結論の値は受け付けない
    const data = await onePagerResponse();
    const payload = sharePayloadFrom(data);
    const tampered = {
      ...payload,
      onePager: { ...payload.onePager, result: "totally_safe" },
    };
    const bad = await decodeShare(await encodeRaw(JSON.stringify(tampered)));
    expect(!bad.ok && bad.reasonJa).toContain("result");
  });

  it("長すぎる d=（64 KB 超）は展開せずに断る", async () => {
    const r = await decodeShare("A".repeat(MAX_SHARE_CHARS + 1));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasonJa).toContain("長すぎます");
    // 上限ちょうどは長さでは断らない（中身が壊れていれば別の理由）
    const r2 = await decodeShare("A".repeat(MAX_SHARE_CHARS));
    expect(!r2.ok && r2.reasonJa).not.toContain("長すぎます");
  });

  it("展開後が巨大になるリンク（圧縮爆弾）は、展開を途中で止めて断る", async () => {
    // 2 MB の同じ文字は deflate で数 KB になる。d= の長さの検査だけでは通ってしまう
    const bomb = new Uint8Array(MAX_INFLATED_BYTES * 2).fill(0x20);
    const piped = new Blob([bomb as BlobPart])
      .stream()
      .pipeThrough(new CompressionStream("deflate"));
    const packed = new Uint8Array(await new Response(piped).arrayBuffer());
    expect(packed.length).toBeLessThan(MAX_SHARE_CHARS / 4);
    await expect(inflateLimited(packed, MAX_INFLATED_BYTES)).rejects.toBeInstanceOf(
      InflateTooLargeError,
    );
    const r = await decodeShare(toBase64Url(packed));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasonJa).toContain("大きすぎます");
    // 上限内なら展開できる
    const small = new Uint8Array(1000).fill(0x20);
    const sp = new Blob([small as BlobPart]).stream().pipeThrough(new CompressionStream("deflate"));
    const out = await inflateLimited(new Uint8Array(await new Response(sp).arrayBuffer()), 2000);
    expect(out.length).toBe(1000);
  });

  it("文字列や配列が長すぎる内容は、項目名と日本語の理由で断る", async () => {
    const data = await onePagerResponse();
    const payload = sharePayloadFrom(data);
    const encodeRaw = async (v: unknown) => {
      const bytes = new TextEncoder().encode(JSON.stringify(v));
      const piped = new Blob([bytes as BlobPart])
        .stream()
        .pipeThrough(new CompressionStream("deflate"));
      return toBase64Url(new Uint8Array(await new Response(piped).arrayBuffer()));
    };
    const longHeadline = await decodeShare(
      await encodeRaw({
        ...payload,
        onePager: { ...payload.onePager, headlineJa: "あ".repeat(LIMITS.title + 1) },
      }),
    );
    expect(longHeadline.ok).toBe(false);
    if (!longHeadline.ok) {
      expect(longHeadline.reasonJa).toContain("onePager.headlineJa");
      expect(longHeadline.reasonJa).toContain("見出しが長すぎます");
    }
    const longLine = await decodeShare(
      await encodeRaw({
        ...payload,
        onePager: { ...payload.onePager, whatHappensJa: ["い".repeat(LIMITS.sentence + 1)] },
      }),
    );
    expect(!longLine.ok && longLine.reasonJa).toContain("長すぎます");
    const manyNotes = await decodeShare(
      await encodeRaw({
        ...payload,
        onePager: { ...payload.onePager, notesJa: Array(LIMITS.items + 1).fill("注") },
      }),
    );
    expect(!manyNotes.ok && manyNotes.reasonJa).toContain("多すぎます");
    // 上限内の正規の一枚はそのまま通る
    expect((await decodeShare(await encodeRaw(payload))).ok).toBe(true);
  });

  it("base64url は + / = を使わず、往復で同じバイト列になる", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255, 62, 63]);
    const text = toBase64Url(bytes);
    expect(text).not.toMatch(/[+/=]/);
    expect(Array.from(fromBase64Url(text) ?? [])).toEqual(Array.from(bytes));
    expect(fromBase64Url("a b")).toBeUndefined();
  });

  it("長さの注記は KB と文字数を出す", () => {
    expect(shareSizeNoteJa(2345)).toContain("約 2.3 KB");
    expect(shareSizeNoteJa(2345)).toContain("2,345 文字");
    expect(shareSizeNoteJa(2345)).toContain("社外に送るとき");
  });
});

describe("共有リンクの URL の読み取り", () => {
  it("d= は形が崩れていても渡し、他の指定より優先する", async () => {
    const { parseOnePagerHash } = await import("../onepager/params.ts");
    expect(parseOnePagerHash("#/onepager?d=abc!!&profile=demo-seiko").d).toBe("abc!!");
    expect(parseOnePagerHash("#/onepager?profile=demo-seiko").d).toBeUndefined();
    expect(parseOnePagerHash("#/onepager").profile).toBeUndefined();
  });
});
