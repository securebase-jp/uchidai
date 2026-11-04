import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ReconResult } from "@uchidai/recon";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { findRealIps, RECON_RECORDING_NOTE, ReconRecording } from "../../shared/reconRecording.ts";
import {
  parseReconRecording,
  REPLAY_AT,
  REPLAY_SECONDS,
  replayItems,
  replayStage,
  replaySummaryItems,
} from "../lib/reconReplay.ts";
import { ReconReplay } from "./ReconReplay.tsx";

const here = dirname(fileURLToPath(import.meta.url));
const recordingPath = join(here, "../../../../../demo/recordings/recon.demo-sec.json");
const recordingText = readFileSync(recordingPath, "utf8");
const recording = parseReconRecording(JSON.parse(recordingText));

const render = (elapsed: number, seconds = REPLAY_SECONDS) =>
  renderToStaticMarkup(createElement(ReconReplay, { elapsed, seconds }));

describe("外部確認の記録（demo/recordings/recon.demo-sec.json）", () => {
  it("形が zod で検証でき、外部確認の結果は recon の ReconResult としても正しい", () => {
    expect(ReconRecording.safeParse(JSON.parse(recordingText)).success).toBe(true);
    expect(ReconResult.safeParse(recording.run.result).success).toBe(true);
  });

  it("実際の外部確認の記録であり、参照は DNS と公開ログだけ・対象のホストには触れていない", () => {
    expect(recording.domain).toBe("demo-sec.com");
    expect(recording.run.fixture).toBe(false);
    expect(recording.note).toBe(RECON_RECORDING_NOTE);
    expect(recording.note).toContain("対象のホストにはアクセスしていない");
    expect(recording.note).toContain("リクエストヘッダは保存していない");
    expect(recording.provenance.targetHostsAccessed).toBe(false);
    expect(recording.provenance.dns).toBe("live");
    expect(recording.run.result.sources).toMatchObject({
      dns: "live",
      ct: "live",
      ctProvider: "certspotter",
    });
    // 公開ログはキャッシュだけを使い、記録のときに新しく問い合わせていない
    expect(recording.provenance.ct.queriedNow).toBe(false);
    expect(Date.parse(recording.provenance.ct.cachedAt)).toBeLessThan(
      Date.parse(recording.recordedAt),
    );
  });

  it("IP アドレスは文書用の予約範囲だけ（実際の IP を公開リポジトリに入れない）。トークンも入れない", () => {
    expect(findRealIps(recordingText)).toEqual([]);
    const addresses = recording.run.result.hostnames.flatMap((h) => h.addresses);
    for (const a of addresses.filter((x) => /^\d/.test(x))) {
      expect(a).toMatch(/^(?:192\.0\.2|198\.51\.100|203\.0\.113)\./);
    }
    expect(recordingText).not.toMatch(/uchidai-verify=[0-9a-f]{16,}/);
    expect(recording.run.result.ownership.record).not.toMatch(/[0-9a-f]{16,}/);
  });

  it("findRealIps は、予約範囲でない IPv4 と IPv6 を拾う", () => {
    expect(findRealIps('{"a":"203.0.113.10","b":"198.51.100.7","c":"192.0.2.1"}')).toEqual([]);
    expect(findRealIps('{"a":"8.8.8.8"}')).toEqual(["8.8.8.8"]);
    expect(findRealIps('{"a":"2606:4700:3030::6815:1a2b","t":"2026-11-04T19:26:00Z"}')).toEqual([
      "2606:4700:3030::6815:1a2b",
    ]);
    expect(findRealIps('{"a":"2001:db8::1"}')).toEqual([]);
  });

  it("カルテ（架空のデモ精工）に反映すると、廃止済みのサイトが外部に残っている矛盾が出る", () => {
    expect(recording.applied.profile).toMatchObject({ id: "demo-seiko", fictional: true });
    const gap = recording.applied.contradictions[0];
    expect(gap?.assetId).toBe("campaign-site");
    expect(gap?.hostname).toBe("campaign2019.demo-sec.com");
    expect(recording.applied.changes.domainChange?.after).toBe("demo-sec.com");
  });
});

describe("replayStage（経過秒から描く段階を決める）", () => {
  it("最初はドメインを打つところ。結果はまだ出ない", () => {
    const s = replayStage(0);
    expect(s).toMatchObject({ phase: "typing", typed: 0, shown: 0, summary: false });
  });

  it("打ち終え → 所有確認の最中 → 確認済み → 結果が 1 つずつ → ほかの確認、の順に進む", () => {
    expect(replayStage(REPLAY_AT.typeEnd + 0.01).typed).toBe(1);
    expect(replayStage(REPLAY_AT.verifyStart + 0.1).phase).toBe("verifying");
    expect(replayStage(REPLAY_AT.verified + 0.1)).toMatchObject({ phase: "verified", shown: 0 });
    const shown = REPLAY_AT.items.map((at) => replayStage(at + 0.05).shown);
    expect(shown).toEqual([1, 2, 3]);
    expect(replayStage(REPLAY_AT.summary - 0.05).summary).toBe(false);
    expect(replayStage(REPLAY_SECONDS)).toMatchObject({ shown: 3, summary: true });
  });

  it("結果は約 1.5 秒おきに出る", () => {
    const [a, b, c] = REPLAY_AT.items;
    expect(b - a).toBeGreaterThanOrEqual(1.4);
    expect(b - a).toBeLessThanOrEqual(1.8);
    expect(c - b).toBeGreaterThanOrEqual(1.4);
    expect(c - b).toBeLessThanOrEqual(1.8);
  });

  it("場面の長さが 14 秒でなければ引き伸ばし、範囲の外は端に止める", () => {
    expect(replayStage(14, 28).t).toBeCloseTo(7);
    expect(replayStage(-3).t).toBe(0);
    expect(replayStage(99).t).toBe(REPLAY_SECONDS);
    expect(replayStage(1, 0).t).toBeGreaterThanOrEqual(0);
  });
});

describe("replayItems（見せる 3 つの結果）", () => {
  it("VPN 用のホスト名、DMARC なし、廃止したはずのサイトの食い違い、の順に 3 つ", () => {
    const items = replayItems(recording);
    expect(items.map((i) => i.key)).toEqual(["vpn", "dmarc", "decommissioned"]);
    const [vpn, dmarc, gap] = items;
    expect(vpn).toMatchObject({
      nameJa: "VPN 用のホスト名が公開されている",
      resultJa: "vpn.demo-sec.com",
      state: "warn",
    });
    expect(dmarc).toMatchObject({ nameJa: "DMARC", resultJa: "なし", state: "bad" });
    expect(gap?.nameJa).toBe("廃止したはずの旧キャンペーンサイトの証明書が、まだ残っている");
    expect(gap?.tagJa).toBe("カルテとの食い違い");
    expect(gap?.resultJa).toBe("campaign2019.demo-sec.com");
  });

  it("ほかの確認は SPF・メールの提供元・証明書の公開ログ", () => {
    const rows = replaySummaryItems(recording);
    expect(rows.map((r) => [r.nameJa, r.resultJa])).toEqual([
      ["SPF", "あり（-all）"],
      ["メールの提供元", "Microsoft 365"],
      ["証明書の公開ログ", "4 件（有効 4）"],
    ]);
  });
});

describe("ReconReplay（elapsed だけで描きが決まる）", () => {
  it("最初から最後まで「対象のホストにはアクセスしません」と記録の札を出す", () => {
    for (const t of [0, 3.5, 7, 14]) {
      const m = render(t);
      expect(m).toContain("対象のホストにはアクセスしません");
      expect(m).toContain("実際に外から見た記録（記録日 2026-11-04、demo-sec.com）");
    }
  });

  it("ドメインを 1 文字ずつ打ち、所有確認 ✓ のあと、結果が順に 3 つ出る", () => {
    const at = (t: number) => render(t);
    expect(at(0)).toContain('data-shown="0"');
    expect(at(0)).not.toContain("所有確認");
    expect(at(1.4)).toMatch(/data-field="domain">demo-/);
    expect(at(1.4)).not.toContain("demo-sec.com</span>");
    expect(at(3.5)).toContain("DNS の TXT レコードを確かめています");
    expect(at(4.5)).toContain("所有確認 ✓");
    expect(at(4.5)).not.toContain("VPN 用のホスト名");
    const one = at(5.6);
    expect(one).toContain("VPN 用のホスト名が公開されている");
    expect(one).toContain("vpn.demo-sec.com");
    expect(one).not.toContain("DMARC");
    const two = at(7.2);
    expect(two).toContain("DMARC");
    expect(two).not.toContain("廃止したはずの");
    const three = at(8.8);
    expect(three).toContain("廃止したはずの旧キャンペーンサイトの証明書が、まだ残っている");
    expect(three).toContain("カルテとの食い違い");
    expect(three).toContain('data-shown="3"');
    expect(three).not.toContain("ほかに見えたこと");
    expect(at(12)).toContain("ほかに見えたこと");
  });

  it("同じ elapsed なら同じ描き（一時停止しても止まる／再開できる）", () => {
    expect(render(5.1)).toBe(render(5.1));
    expect(render(5.1)).not.toBe(render(5.2));
  });

  it("推定の項目には「推定」の札、色だけに頼らずアイコンの読み上げ名も付く", () => {
    const m = render(9);
    expect(m).toContain("推定");
    expect(m).toContain('aria-label="要確認"');
    expect(m).toContain('aria-label="問題あり"');
  });

  it("ネットワークにも副作用にも出ない（fetch・通信・effect を使うソースがない）", () => {
    for (const file of [
      join(here, "ReconReplay.tsx"),
      join(here, "../lib/reconReplay.ts"),
      join(here, "../../shared/reconRecording.ts"),
    ]) {
      const src = readFileSync(file, "utf8");
      expect(src, file).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon/);
      expect(src, file).not.toMatch(
        /\buse(?:Effect|LayoutEffect)\b|setTimeout|setInterval|Date\.now/,
      );
    }
  });
});
