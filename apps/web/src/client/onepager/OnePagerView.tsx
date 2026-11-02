/**
 * 社長向けの一枚：白い紙の上に、結論 → 何が起きるか（経路図）→ 止まる業務 → 金額 → 期限 → 対策 → 出典。
 * 専門用語と ID は出さない。数値はすべて engine の計算結果をそのまま描く。
 */

import type { OnePagerResponse } from "../lib/api.ts";
import { RESULT_TONE, yen } from "../lib/labels.ts";
import type { OnePagerDeadline, OnePagerMeasure } from "../lib/types.ts";
import { StaticDiagram } from "./StaticDiagram.tsx";
import "./onepager.css";

const KIND_JA: Record<OnePagerDeadline["kind"], string> = {
  legal: "法律",
  insurance: "保険",
  partner: "取引先",
  police: "警察",
  money: "資金",
};
const BASIS_JA: Record<OnePagerMeasure["basis"], string> = {
  ipa: "公開資料の単価",
  quote: "見積もり待ち",
  internal: "社内ルール",
};
const RESULT_WORD: Record<OnePagerResponse["onePager"]["result"], string> = {
  breached: "大丈夫ではない",
  mitigated: "被害は抑えられる",
  blocked: "止められる",
  pending: "確認中",
  no_entry: "入口なし",
  out_of_scope: "対象外",
};

type Props = {
  data: OnePagerResponse;
  measureLabel?: (mitigation: string) => string;
  generatedAt?: Date;
};

export function OnePagerView({ data, measureLabel, generatedAt = new Date() }: Props) {
  const { onePager: op, graph, verdict, profile, measures } = data;
  const tone = RESULT_TONE[op.result];
  const maxDays = Math.max(1, ...op.stopped.map((s) => s.days));
  const deadlines = [...op.deadlines].sort((a, b) => a.day - b.day);
  const date = generatedAt.toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const appliedNames = measures.map((m) => m.labelJa);

  return (
    <article className={`op-paper tone-${tone}`} lang="ja">
      <header className="op-head">
        <div className="op-kicker">
          <span className="op-mono">社長向けの一枚</span>
          {op.fictional && <span className="op-fiction">架空の会社</span>}
        </div>
        <h1 className="op-company">{op.companyName}</h1>
        <p className="op-meta">
          {date} 作成　／　もとにした事例：{op.caseTitle || "公開された事例"}
          {appliedNames.length > 0 && `　／　入れた対策：${appliedNames.join("、")}`}
        </p>
      </header>

      <section className="op-sec op-verdict">
        <div className="op-num">01</div>
        <h2 className="op-h">結論</h2>
        <p className="op-headline">{op.headlineJa}</p>
        <p className="op-sub">
          報道と同じ攻撃が、いまの会社の構成に来たら：
          <b className="op-word">{RESULT_WORD[op.result]}</b>
        </p>
      </section>

      <section className="op-sec op-what">
        <div className="op-num">02</div>
        <h2 className="op-h">何が起きるか</h2>
        <StaticDiagram
          graph={graph}
          verdict={verdict}
          profile={profile}
          applied={measures}
          {...(measureLabel ? { measureLabel } : {})}
        />
        <ol className="op-lines">
          {op.whatHappensJa.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ol>
      </section>

      <section className="op-sec op-stopped">
        <div className="op-num">03</div>
        <h2 className="op-h">止まる業務と日数</h2>
        {op.stopped.length === 0 ? (
          <p className="op-none">この攻撃では、業務は止まりません。</p>
        ) : (
          <ul className="op-biz">
            {op.stopped.map((s) => (
              <li key={s.name}>
                <div className="op-biz-row">
                  <span className="op-biz-name">{s.name}</span>
                  <span className="op-biz-days">
                    <b>{s.days}</b> 日
                  </span>
                </div>
                <div className="op-bar" aria-hidden="true">
                  <i style={{ width: `${(100 * s.days) / maxDays}%` }} />
                  <em style={{ left: `${(100 * Math.min(s.manualDays, s.days)) / maxDays}%` }} />
                </div>
                <p className="op-biz-note">
                  手作業で回せるのは {s.manualDays} 日まで
                  {s.partnerDay !== undefined && s.affectsJa
                    ? `。${s.partnerDay} 日目から${s.affectsJa}に影響`
                    : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
        {op.partnerImpactJa && <p className="op-note">{op.partnerImpactJa}</p>}
      </section>

      {(op.revenueImpactJpy !== undefined || op.moneyLossJpy !== undefined) && (
        <section className="op-sec op-money">
          <div className="op-num">04</div>
          <h2 className="op-h">お金への影響の目安</h2>
          <div className="op-figures">
            {op.revenueImpactJpy !== undefined && (
              <div className="op-figure-box">
                <span className="op-k">売上への影響</span>
                <span className="op-v">{yen(op.revenueImpactJpy)}</span>
                <span className="op-f">
                  {op.revenueImpactJa?.replace(/^売上影響の目安 [^（]+/, "")}
                </span>
              </div>
            )}
            {op.moneyLossJpy !== undefined && (
              <div className="op-figure-box">
                <span className="op-k">流出する資金</span>
                <span className="op-v">{yen(op.moneyLossJpy)}</span>
                <span className="op-f">会社カルテの想定額</span>
              </div>
            )}
          </div>
        </section>
      )}

      <section className="op-sec op-deadlines">
        <div className="op-num">05</div>
        <h2 className="op-h">期限（起きた日を 0 日目として）</h2>
        {deadlines.length === 0 ? (
          <p className="op-none">この攻撃では、届け出や連絡の期限は生じません。</p>
        ) : (
          <ol className="op-spine">
            {deadlines.map((d) => (
              <li key={`${d.day}-${d.labelJa}`} className={`k-${d.kind}`}>
                <span className="op-day">
                  <b>{d.day}</b>
                  <small>日目</small>
                </span>
                <span className="op-dl">
                  <span className="op-dl-kind">{KIND_JA[d.kind]}</span>
                  <span className="op-dl-label">{d.labelJa}</span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="op-sec op-measures">
        <div className="op-num">06</div>
        <h2 className="op-h">必要な対策と、費用の目安、依頼先</h2>
        {op.measures.length === 0 ? (
          <p className="op-none">
            {op.result === "blocked" || op.result === "mitigated"
              ? "いまの対策で、この攻撃は経路の途中で止まります。"
              : "この経路に効く対策は、登録された対策ボタンの中にはありません。"}
          </p>
        ) : (
          <ul className="op-cards">
            {op.measures.map((m) => (
              <li key={m.id} className="op-card">
                <div className="op-card-top">
                  <span className="op-card-name">{m.labelJa}</span>
                  <span className={`op-basis b-${m.basis}`}>{BASIS_JA[m.basis]}</span>
                </div>
                {m.stageJa && <p className="op-card-stage">効くところ：{m.stageJa}</p>}
                <p className="op-card-cost">
                  {m.costJpy !== undefined ? (
                    <>
                      <b>{yen(m.costJpy)}</b>
                      <span>{m.costJa.replace(/^[^（]*/, "")}</span>
                    </>
                  ) : (
                    <b className="soft">{m.costJa}</b>
                  )}
                </p>
                {m.requestToJa && <p className="op-card-to">依頼先：{m.requestToJa}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="op-foot">
        <h3>出典と注記</h3>
        <ul className="op-sources">
          {op.sources.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
        <ul className="op-notes">
          {op.notesJa.map((n) => (
            <li key={n}>{n}</li>
          ))}
          <li>
            「何が起きるか」の文は
            {data.text.source === "claude"
              ? `Claude（${data.text.model ?? "モデル名不明"}）が役割名と数値だけから言い換えました。数値は検証しています。`
              : "プログラムのテンプレート文です。"}
            {data.text.noteJa ? `（${data.text.noteJa}）` : ""}
          </li>
        </ul>
        <p className="op-brand">
          ウチダイ　うちの会社は大丈夫？　— 攻撃の段階の対応づけは MITRE ATT&amp;CK Enterprise v
          {verdict.attackVersion}
        </p>
      </footer>
    </article>
  );
}
