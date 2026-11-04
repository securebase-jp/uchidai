/**
 * デモ場面 4 の「外部確認の再生」。demo-sec.com を実際に一度だけ外部確認して残した記録を、約 14 秒で再生する。
 * ドメインを入れる → 所有確認 ✓ → 結果が 1 つずつ出る（VPN 用のホスト名、DMARC、廃止したはずのサイトの食い違い）。
 * 描きは elapsed だけで決まる（一時停止すれば止まり、再開すれば続きから）。ネットワークには一切出ない。
 *
 * 差し込み口（demo/slots.tsx の SlotProps）の形：{ elapsed, seconds }。
 *   SLOTS["slot:recon"] = ReconReplaySlot;   // 全画面の枠（.demo-slot.full）に入れる
 * 行の見た目は外部確認の画面（ReconResultView）の部品を使う。新しい見た目は枠の見出しと札だけ。
 */
import { ShieldCheck } from "lucide-react";
import type { CSSProperties } from "react";
import recordingJson from "../../../../../demo/recordings/recon.demo-sec.json";
import type { ReconRecording } from "../../shared/reconRecording.ts";
import {
  appearProgress,
  parseReconRecording,
  REPLAY_AT,
  type ReplayItem,
  recordedDateJst,
  replayItems,
  replayStage,
  replaySummaryItems,
} from "../lib/reconReplay.ts";
import { ctSourceIds, ctSourceLabel } from "../lib/reconView.ts";
import "./flow.css";
import "./ReconReplay.css";
import { CheckIcon } from "./ReconResultView.tsx";
import { SourceRef } from "./SourceRef.tsx";

const DEFAULT_RECORDING: ReconRecording = parseReconRecording(recordingJson);

const CT_NAME: Record<string, string> = { crtsh: "crt.sh", certspotter: "Cert Spotter" };

type Props = {
  elapsed: number;
  seconds: number;
  /** 差し替え用（テスト）。既定は demo/recordings/recon.demo-sec.json */
  recording?: ReconRecording;
};

function fade(p: number): CSSProperties {
  return { opacity: p, transform: `translateY(${(1 - p) * 10}px)` };
}

function ItemRow({ item, p }: { item: ReplayItem; p: number }) {
  return (
    <li className={`chk-item state-${item.state} rr-item`} style={fade(p)} data-item={item.key}>
      <div className="chk-line">
        <CheckIcon state={item.state} size={26} />
        <div className="chk-text">
          <span className="chk-name">{item.nameJa}</span>
          <span className={`chk-result${item.mono ? " mono" : ""}`}>
            {item.resultJa}
            {item.inferred && <span className="chk-guess">推定</span>}
          </span>
          {item.subJa && <span className="chk-sub muted small">{item.subJa}</span>}
        </div>
        {item.tagJa && <span className="chk-tag">{item.tagJa}</span>}
      </div>
    </li>
  );
}

export function ReconReplay({ elapsed, seconds, recording = DEFAULT_RECORDING }: Props) {
  const stage = replayStage(elapsed, seconds);
  const { result } = recording.run;
  const items = replayItems(recording);
  const summary = replaySummaryItems(recording);
  const typedChars = Math.round(recording.domain.length * stage.typed);
  const typedText = recording.domain.slice(0, typedChars);
  const ctIds = ctSourceIds(result.sources);
  return (
    <section
      className="recon-replay"
      aria-label="外部確認の再生（実際の記録）"
      data-phase={stage.phase}
      data-shown={stage.shown}
      data-summary={stage.summary}
    >
      <header className="rr-head">
        <p className="rr-noaccess">
          <ShieldCheck size={40} strokeWidth={2.2} aria-hidden="true" />
          対象のホストにはアクセスしません
        </p>
        <p className="rr-badges">
          <span className="chip rr-record">
            実際に外から見た記録（記録日 {recordedDateJst(recording)}、{recording.domain}）
          </span>
          <span className="chip">参照：DNS の公開レコードと証明書の公開ログだけ</span>
        </p>
      </header>

      <div className="panel rr-panel">
        <h2>自社の姿を、外から見る</h2>
        <div className="rr-input">
          <span className="rr-label">ドメイン</span>
          <span className="rr-domain mono" data-field="domain">
            {typedText}
            {stage.typed < 1 && (
              <span className="rr-caret" aria-hidden="true">
                ▍
              </span>
            )}
          </span>
          <span className="btn rr-btn" aria-hidden="true">
            外部確認する
          </span>
        </div>

        {stage.t >= REPLAY_AT.verifyStart && (
          <p
            className="rr-owner"
            style={fade(appearProgress(stage.t, REPLAY_AT.verifyStart))}
            data-field="ownership"
          >
            <CheckIcon state={stage.phase === "verified" ? "ok" : "info"} size={26} />
            {stage.phase === "verified"
              ? "所有確認 ✓　DNS の TXT レコードで、自社のドメインだと確かめました"
              : "所有確認：DNS の TXT レコードを確かめています…"}
          </p>
        )}

        <ul className="chk-list rr-list" aria-label="外部確認の結果">
          {items.slice(0, stage.shown).map((item, i) => (
            <ItemRow
              key={item.key}
              item={item}
              p={appearProgress(stage.t, REPLAY_AT.items[i] ?? REPLAY_AT.summary)}
            />
          ))}
        </ul>

        {stage.summary && (
          <div style={fade(appearProgress(stage.t, REPLAY_AT.summary))} data-field="summary">
            <p className="rr-more-title">ほかに見えたこと</p>
            <ul className="chk-list rr-more">
              {summary.map((item) => (
                <li key={item.key} className={`chk-item state-${item.state}`}>
                  <div className="chk-line">
                    <CheckIcon state={item.state} size={20} />
                    <div className="chk-text">
                      <span className="chk-name">{item.nameJa}</span>
                      <span className="chk-result">
                        {item.resultJa}
                        {item.inferred && <span className="chk-guess">推定</span>}
                      </span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <p className="rr-foot muted small">
        証明書ログ：{ctSourceLabel(result.sources)}
        {ctIds.map((id, i) => (
          <SourceRef key={id} id={id} n={i + 1} titleJa={CT_NAME[id] ?? id} />
        ))}
        ／ 会社のカルテは架空のデモ精工
      </p>
    </section>
  );
}

/** 差し込み口（SlotProps）に入れる部品。全画面の枠に包んで描く */
export function ReconReplaySlot({ elapsed, seconds }: { elapsed: number; seconds: number }) {
  return (
    <div className="demo-slot full">
      <ReconReplay elapsed={elapsed} seconds={seconds} />
    </div>
  );
}
