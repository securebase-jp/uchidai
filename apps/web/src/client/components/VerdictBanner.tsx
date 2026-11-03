/**
 * 結論：動きが止まった瞬間に明朝体で大きく。途中は進行の説明。
 * conclusionFirst（担当者画面）では結論を常に出し、再生中の進み（「◯◯が突破されました」）は同じ枠の中に小さく出す。
 * 突破の言葉は型紙の段階が持っていればそれ（「バックアップが暗号化されました」）、無ければ「突破されました」
 */
import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import { PLAIN_STATE, RESULT_TONE, STATE_LABEL, yen } from "../lib/labels.ts";
import { unknownStepLabels } from "../lib/pending.ts";
import type { Scene, Script } from "../lib/playback.ts";
import type { Graph, Verdict } from "../lib/types.ts";

type Props = {
  verdict: Verdict;
  scene: Scene;
  script: Script;
  graph: Graph;
  fired: number;
  caseTitle?: string;
  plain?: boolean;
  big?: boolean;
  swapping?: boolean;
  /** 結論を常に大見出しに出し、再生の進みは小さく添える（担当者画面） */
  conclusionFirst?: boolean;
  /** 理由の一文（結論の下） */
  reasonJa?: string;
  /** 見出しの横に置く情報ボタンなど */
  info?: ReactNode;
  /** 次の一手・未確認の件数など、結論の下に置くもの */
  children?: ReactNode;
  /**
   * 赤の結論（大丈夫ではありませんでした）に達した瞬間、縁をゆっくり 3 回点滅させてから脈打たせ、左に「警告」の札を出す（社長画面）。
   * 「動きを減らす」設定では点滅せず、赤い縁と札だけになる。担当者画面は渡さないので従来どおり
   */
  alert?: boolean;
};

function progressText(
  script: Script,
  graph: Graph,
  fired: number,
  plain: boolean,
): [string, string] {
  let last: Extract<Script["beats"][number], { kind: "arrive" | "hit" }> | undefined;
  for (let i = fired - 1; i >= 0; i--) {
    const b = script.beats[i];
    if (b && (b.kind === "arrive" || b.kind === "hit")) {
      last = b;
      break;
    }
  }
  if (!last)
    return ["攻撃が来ました", "Day 0。平時のデータの流れの中に、社外から攻撃者が現れます。"];
  const label = graph.nodes.find((n) => n.id === last.nodeId)?.label ?? last.nodeId;
  if (last.kind === "arrive") {
    const word = plain ? PLAIN_STATE[last.state] : STATE_LABEL[last.state];
    const head =
      last.state === "breached"
        ? `${label} が${last.breachedDoneJa ?? "突破されました"}`
        : last.state === "blocked"
          ? `${label} で止まりました`
          : last.state === "recoverable"
            ? `${label} はやられますが、戻せます`
            : `${label} は${word}`;
    const sub = last.ineffective.length
      ? `入れた対策「${last.ineffective.map((x) => x.reasonJa).join("」「")}」`
      : last.labelJa
        ? `段階：${last.labelJa}`
        : "";
    return [head, sub];
  }
  return [
    last.layer === "business" ? "業務が止まります" : "経営に影響が広がります",
    `${label}：${last.labelJa}`,
  ];
}

export function VerdictBanner({
  verdict,
  scene,
  script,
  graph,
  fired,
  caseTitle,
  plain = false,
  big = false,
  swapping = false,
  conclusionFirst = false,
  reasonJa,
  info,
  children,
  alert = false,
}: Props) {
  const concluded = scene.concluded;
  const [head, sub] = swapping
    ? ["時間を巻き戻しています", "同じ攻撃を、条件を変えてもう一度走らせます。"]
    : concluded
      ? [verdict.headlineJa, summary(verdict, plain, graph)]
      : progressText(script, graph, fired, plain);

  if (conclusionFirst) {
    const tone = RESULT_TONE[verdict.result];
    const impact = summary(verdict, plain);
    const running = swapping || !concluded;
    return (
      <section className={`verdict verdict-card tone-${tone}`} aria-live="polite">
        <div className="verdict-head">
          <p className="t">{verdict.headlineJa}</p>
          {info}
        </div>
        {reasonJa && <p className="s">{reasonJa}</p>}
        {impact && <p className="s verdict-impact">{impact}</p>}
        <AnimatePresence mode="wait">
          {running && (
            <motion.p
              key={head}
              className="verdict-progress"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
            >
              <span className="verdict-progress-head">{head}</span>
              {sub && <span className="verdict-progress-sub">　{sub}</span>}
            </motion.p>
          )}
        </AnimatePresence>
        {children}
      </section>
    );
  }

  const tone = concluded ? RESULT_TONE[verdict.result] : "";
  const alarm = alert && concluded && !swapping && tone === "red";
  return (
    <section
      className={`verdict ${tone ? `tone-${tone}` : ""}${big && concluded ? " big" : ""}${alarm ? " alarm" : ""}`}
      aria-live="polite"
    >
      {alarm && <span className="verdict-badge">警告</span>}
      <AnimatePresence mode="wait">
        <motion.div
          key={head}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
        >
          <p className="t">{head}</p>
          <p className="s">{sub || (caseTitle ? `事例：${caseTitle}` : "")}</p>
        </motion.div>
      </AnimatePresence>
    </section>
  );
}

export function summary(v: Verdict, plain: boolean, graph?: Graph): string {
  const parts: string[] = [];
  const i = v.impact;
  // 未確認の段階を通って到達した結論は最悪の想定（未確認は「止まる」とは扱わない）
  const unknown = graph ? unknownStepLabels(v, graph) : [];
  if (v.result === "breached" && unknown.length > 0)
    parts.push(
      plain
        ? `確認が取れていない所（${unknown.join("、")}）は、入られるものとして見ています`
        : `未確認の段階（${unknown.join("、")}）は突破されるとみなした最悪の想定です`,
    );
  if (i.downtimeDays > 0)
    parts.push(`${i.stopped.map((s) => s.name).join("・")}が約 ${i.downtimeDays} 日止まります`);
  if (i.revenueImpactJpy) parts.push(`売上影響の目安は ${yen(i.revenueImpactJpy)}`);
  if (i.moneyLossJpy) parts.push(`${yen(i.moneyLossJpy)} が流出します`);
  if (i.reportRequired)
    parts.push(
      plain
        ? "個人情報の漏えいのおそれがあり、国への報告義務が生じます"
        : "個人情報保護委員会への報告義務が生じます",
    );
  if (v.result === "blocked") parts.push("データは流れ続け、現場は動き続けます");
  if (v.result === "pending") parts.push("未確認の項目を確認すると結論が決まります");
  if (v.result === "no_entry") parts.push("この事例の入口になる構成が御社にありません");
  return parts.join("。");
}
