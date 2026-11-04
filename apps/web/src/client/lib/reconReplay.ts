/**
 * デモ場面 4 の「外部確認の再生」の、時刻と中身の決め方（純粋な関数。ネットワークにも出ない）。
 * - replayStage：経過秒から、どこまで描くか（入力・所有確認・結果の 3 つ・ほかの確認）を決める
 * - replayItems：記録から、見せる 3 つの結果（VPN 用ホスト名、DMARC、廃止済みサイトの食い違い）を組み立てる
 * 判定も推定もここではしない。記録（実際に外部確認して得た結果）の値を並べるだけ。
 */
import { ReconRecording, type ReconRecording as Recording } from "../../shared/reconRecording.ts";
import { type CheckState, checkRows } from "./reconView.ts";

/** 再生の長さ（秒）。場面の長さがこれと違うときは、経過をこの長さに引き伸ばして使う */
export const REPLAY_SECONDS = 14;

/** 再生の時刻表（REPLAY_SECONDS の時計での秒） */
export const REPLAY_AT = {
  typeStart: 0.4,
  typeEnd: 2.4,
  verifyStart: 2.8,
  verified: 4.2,
  /** 結果は 1 つずつ、約 1.6 秒おきに出す */
  items: [5.0, 6.6, 8.2],
  summary: 10.2,
} as const;

export type ReplayPhase = "typing" | "verifying" | "verified";

export type ReplayStage = {
  /** 再生の時計での秒（0 〜 REPLAY_SECONDS） */
  t: number;
  /** 入力欄に打ち終えた文字数（ドメインの文字数に対する割合を掛ける前の 0〜1） */
  typed: number;
  phase: ReplayPhase;
  /** 出した結果の数（0〜3） */
  shown: number;
  /** ほかの確認（SPF など）まで出したか */
  summary: boolean;
};

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** 経過秒（場面の開始から。一時停止中は進まない）から、描く段階を決める */
export function replayStage(elapsed: number, seconds: number = REPLAY_SECONDS): ReplayStage {
  const span = Math.max(1, seconds);
  const t = clamp01(elapsed / span) * REPLAY_SECONDS;
  const typed = clamp01((t - REPLAY_AT.typeStart) / (REPLAY_AT.typeEnd - REPLAY_AT.typeStart));
  const phase: ReplayPhase =
    t >= REPLAY_AT.verified ? "verified" : t >= REPLAY_AT.verifyStart ? "verifying" : "typing";
  const shown = REPLAY_AT.items.filter((at) => t >= at).length;
  return { t, typed, phase, shown, summary: t >= REPLAY_AT.summary };
}

/** 出現の進み具合（0〜1）。at から duration 秒で 1 になる。経過だけで決まるので、一時停止すれば止まる */
export function appearProgress(t: number, at: number, duration = 0.35): number {
  return clamp01((t - at) / duration);
}

export type ReplayItem = {
  key: string;
  state: CheckState;
  nameJa: string;
  /** 結果（短く）。ホスト名は等幅で出す */
  resultJa: string;
  mono: boolean;
  /** 固定表の当てはめによる推定か */
  inferred: boolean;
  /** 右に出す札（カルテとの食い違い、など） */
  tagJa?: string;
  /** 補足の 1 行（外から見えた内容） */
  subJa?: string;
};

/** 記録の JSON を検証して返す（形が違えば例外） */
export function parseReconRecording(json: unknown): Recording {
  return ReconRecording.parse(json) as unknown as Recording;
}

/** 記録日（JST）。例：2026-11-04 */
export function recordedDateJst(recording: Recording): string {
  return new Date(Date.parse(recording.recordedAt) + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

const SHORT_LABEL = (label: string) => label.replace(/（廃止済み）$/, "");

/** 見せる 3 つの結果：① VPN 用のホスト名 ② DMARC ③ 廃止したはずのサイトの食い違い。記録に無い項目は出さない */
export function replayItems(recording: Recording): ReplayItem[] {
  const rows = checkRows(recording.run.result);
  const items: ReplayItem[] = [];

  const vpn = rows.find((r) => r.id === "remote_access.vpn");
  const vpnHosts = (vpn?.candidates ?? []).filter((c) => c.current).map((c) => c.hostname);
  if (vpn && vpnHosts.length > 0) {
    items.push({
      key: "vpn",
      state: vpn.state,
      nameJa: "VPN 用のホスト名が公開されている",
      resultJa: vpnHosts.join("、"),
      mono: true,
      inferred: true,
    });
  }

  const dmarc = rows.find((r) => r.id === "mail_auth.dmarc");
  if (dmarc) {
    items.push({
      key: "dmarc",
      state: dmarc.state,
      nameJa: dmarc.nameJa,
      resultJa: dmarc.resultJa,
      mono: false,
      inferred: false,
    });
  }

  const gap = recording.applied.contradictions[0];
  if (gap) {
    items.push({
      key: "decommissioned",
      state: "warn",
      nameJa: `廃止したはずの${SHORT_LABEL(gap.assetLabel)}の証明書が、まだ残っている`,
      resultJa: gap.hostname,
      mono: true,
      inferred: false,
      tagJa: "カルテとの食い違い",
      subJa: `外から見えたもの：${gap.external}`,
    });
  }
  return items;
}

/** ほかの確認（結果の 3 つのあとに、短く並べる）：SPF、メールの提供元、証明書の公開ログ */
export function replaySummaryItems(recording: Recording): ReplayItem[] {
  const ids = ["mail_auth.spf", "mail_provider.mx", "hostnames.ct"];
  const rows = checkRows(recording.run.result);
  return ids.flatMap((id) => {
    const r = rows.find((x) => x.id === id);
    return r
      ? [
          {
            key: r.id,
            state: r.state,
            nameJa: r.nameJa,
            resultJa: r.resultJa,
            mono: false,
            inferred: r.inferred,
          },
        ]
      : [];
  });
}
