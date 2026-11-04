/**
 * デモの差し込み口に入れる部品：AI攻撃者、ベンダーへの確認（記録から）、知見なし AI との並置の実際の画面を、
 * 場面の途中から自動で動かして重ねる。時刻は、その差し込み口が出てからの経過秒数（elapsed）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AiAttackerPanel } from "../components/AiAttackerPanel.tsx";
import { OutboxItem } from "../components/OutboxPanel.tsx";
import { useAiAttacker } from "../hooks/useAiAttacker.tsx";
import { useApp } from "../hooks/useApp.tsx";
import "../components/requests.css";
import vendorRequestJson from "../../../../../demo/recordings/vendor-request.demo-seiko.json";
import type { ReplyRequest, RequestView } from "../../shared/requests.ts";
import {
  answerFromReply,
  parseVendorRequestRecording,
  requestFromRecording,
  type VendorRequestRecording,
} from "../../shared/vendorRequestRecording.ts";
import type { ComparedMitigation } from "../lib/attackerApi.ts";
import type { SlotProps } from "./slots.tsx";

/** AiAttackerPanel が 1 行ずつ出す間隔（秒）。検証の瞬間を、ログを出し終えた時刻に合わせる */
const LOG_LINE_SECONDS = 0.42;
const VERIFY_POINTS = ["手法 ID", "役割", "つながり", "判定ルール"];

/**
 * AI攻撃者：場面に入ったら記録した下見の出力を再生し（毎回同じ映像にする）、過程と結果を表示。
 * ログを出し終えたら「採用 n・破棄 m」と、4 点の検証の ✓ を順に出す（数は検証結果そのもの）
 */
export function AiAttackerSlot({ elapsed }: SlotProps) {
  const app = useApp();
  const ai = useAiAttacker();
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !app.evaluation || ai.busy || ai.paths.length > 0) return;
    started.current = true;
    void ai.run({ replay: true });
  }, [app.evaluation, ai]);
  if (!app.evaluation || !app.knowledge) return null;
  const t = elapsed - (ai.log.length * LOG_LINE_SECONDS + 0.4);
  return (
    <div className="demo-slot full">
      <AiAttackerPanel
        graph={app.evaluation.graph}
        verdict={app.evaluation.verdict}
        labels={app.knowledge.labels}
        measures={app.knowledge.measures}
        reduced={false}
      />
      {ai.ran && ai.log.length > 0 && t >= 0 && (
        <div className="ai-verify" role="status">
          <span className="ai-count">
            採用 <b>{ai.paths.length}</b>　破棄 <b>{ai.discarded.length}</b>
          </span>
          <span className="ai-checks">
            検証
            {VERIFY_POINTS.map((p, i) => (
              <span key={p} className={t >= 0.4 + i * 0.35 ? "in" : ""}>
                ✓ {p}
              </span>
            ))}
          </span>
        </div>
      )}
    </div>
  );
}

type Kind = "effective" | "ineffective" | "outside";
type Row = { item: ComparedMitigation; kind: Kind };

/**
 * 知見なし AI との並置：左に一般的な AI の提案（挙げた順）、右に同じ提案へのウチダイの判定。
 * 「効かない」の印が付くのは、判定ルールで効かないと決まった提案だけ（多要素認証）。
 */
export function ComparisonSlot({ elapsed }: SlotProps) {
  const app = useApp();
  const ai = useAiAttacker();
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !app.evaluation || ai.compareBusy || ai.comparison) return;
    started.current = true;
    void ai.runCompare();
  }, [app.evaluation, ai]);

  const c = ai.comparison;
  const rows: Row[] = [];
  if (c) {
    const all: Row[] = [
      ...c.effective.map((item) => ({ item, kind: "effective" as const })),
      ...c.ineffective.map((item) => ({ item, kind: "ineffective" as const })),
      ...[...c.outside, ...c.unmapped].map((item) => ({ item, kind: "outside" as const })),
    ];
    // 一般的な AI が挙げた順に並べ直す（挙げた順が分からないときは振り分けの順）
    const order = ai.compareItems?.map((x) => x.nameJa) ?? [];
    const pos = (r: Row) => {
      const i = order.indexOf(r.item.nameJa);
      return i < 0 ? order.length : i;
    };
    rows.push(...all.sort((a, b) => pos(a) - pos(b)));
  }

  return (
    <div className="demo-slot full">
      <div className="panel dcmp">
        <div className="dcmp-head">
          <h2>一般的な AI の提案（{rows.length} 件）</h2>
          <h2>ウチダイの判定（この会社・この攻撃）</h2>
        </div>
        {rows.length === 0 && <p className="muted">取り寄せています…</p>}
        <ol className="dcmp-rows">
          {rows.map((r, i) => {
            const at = 0.4 + i * 0.45;
            const shown = elapsed >= at;
            const judged = elapsed >= at + 0.3;
            return (
              <li
                key={`${r.item.mitigation ?? "-"}-${r.item.nameJa}`}
                className={`dcmp-row ${r.kind}${shown ? " in" : ""}`}
              >
                <span className="dcmp-ai">{r.item.nameJa}</span>
                <span className={`dcmp-judge${judged ? " in" : ""}`}>
                  {r.kind === "effective" && (
                    <b className="chip-ok">
                      効く{r.item.stageLabelJa ? `（${r.item.stageLabelJa}）` : ""}
                    </b>
                  )}
                  {r.kind === "ineffective" && (
                    <>
                      <b className="chip-ng">効かない</b>
                      {r.item.verdictReasonJa && <small>{r.item.verdictReasonJa}</small>}
                    </>
                  )}
                  {r.kind === "outside" && <span className="chip-out">この攻撃には関係しない</span>}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

/**
 * ベンダーへの確認：絵コンテの操作（click / fill）で「ベンダーに確認する」→ 番号つきのメール → 返信の番号を入力 →
 * 判定の更新、を、本物の送信箱の部品（OutboxItem）で動かす。
 * 依頼は、Claude で実際に生成して残した記録（demo/recordings/vendor-request.demo-seiko.json）から組み立てる。
 * サーバにも送信箱にも依頼を作らず、Claude も呼ばない（作成が遅く、文面も毎回変わるため。毎回同じ映像になる）。
 * 返信の入力は、サーバの recordReply と同じ形の回答（answerFromReply）を作り、本物と同じく判定に反映する。
 */
const REQUEST_RECORDING: VendorRequestRecording = parseVendorRequestRecording(vendorRequestJson);

export function RequestSlot(_props: SlotProps) {
  const app = useApp();
  const { addAnswer, removeAnswer } = app;
  const [asked, setAsked] = useState(false);
  const [item, setItem] = useState<RequestView>(() => requestFromRecording(REQUEST_RECORDING));

  const reply = useCallback(
    async (_id: string, body: ReplyRequest): Promise<string | undefined> => {
      const answer = answerFromReply(REQUEST_RECORDING, body);
      const choice = REQUEST_RECORDING.choiceMap.find((c) => c.id === body.choice);
      if (!answer || !choice) return "回答を入力できませんでした";
      addAnswer(answer);
      const enteredBy = body.enteredBy?.trim();
      setItem((it) => ({
        ...it,
        answeredBy: answer.answeredBy,
        ...(answer.answeredAt ? { answeredAt: answer.answeredAt } : {}),
        ...(enteredBy ? { enteredBy } : {}),
        enteredAt: new Date().toISOString(),
        answer: { choice: choice.id, choiceLabelJa: choice.labelJa, input: answer },
      }));
      return undefined;
    },
    [addAnswer],
  );
  const retract = useCallback(async (): Promise<string | undefined> => {
    removeAnswer(REQUEST_RECORDING.assetId, REQUEST_RECORDING.mitigation);
    setItem(requestFromRecording(REQUEST_RECORDING));
    return undefined;
  }, [removeAnswer]);

  const mit =
    app.knowledge?.labels.mitigations[item.mitigation] ?? item.background.mitigationLabelJa;
  return (
    <div className="demo-slot full vendor">
      <div className="panel">
        <h2>ベンダーへの確認依頼</h2>
        <div className="req-row">
          <div className="what">
            <b>
              {item.assetLabel}　{mit}（<code>{item.mitigation}</code>）
            </b>
            <span className="chip on-path">この攻撃の経路：管理者の権限</span>
          </div>
          {asked ? (
            <span className="st amber">{item.answer ? "回答あり" : "依頼済み・回答待ち"}</span>
          ) : (
            <button type="button" className="btn sm primary ask-btn" onClick={() => setAsked(true)}>
              ベンダーに確認する
            </button>
          )}
        </div>
        {asked && <OutboxItem item={item} onReply={reply} onRetract={retract} />}
      </div>
    </div>
  );
}
