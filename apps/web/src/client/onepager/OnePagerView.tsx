/**
 * 社長向けの一枚：白い紙の上に、結論 → 何が起きるか（経路図）→ 止まる業務 → 金額 → 期限 → 対策 → 出典。
 * 専門用語と ID は出さない。数値はすべて engine の計算結果をそのまま描く。
 * 共有リンク（内容を URL に載せた形）から開いたときは、経路図（構成グラフが要る）だけ無い一枚になる。
 */

import { useEffect, useRef } from "react";
import { SourceRef } from "../components/SourceRef.tsx";
import type { OnePagerResponse } from "../lib/api.ts";
import { RESULT_TONE, yen } from "../lib/labels.ts";
import type { SharePayload } from "../lib/onepager-share.ts";
import { eventSourceId } from "../lib/timeline-view.ts";
import type {
  CompanyProfile,
  Graph,
  MeasureDef,
  OnePager,
  OnePagerDeadline,
  OnePagerMeasure,
  Verdict,
} from "../lib/types.ts";
import { DeadlineAxis } from "./DeadlineAxis.tsx";
import { cutPoints, type FitList } from "./fit.ts";
import { StaticDiagram } from "./StaticDiagram.tsx";
import { fitSheet } from "./sheet-layout.ts";
import { sourceNumbers, sourceTitle } from "./source-numbers.ts";
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
const RESULT_WORD: Record<OnePager["result"], string> = {
  breached: "大丈夫ではない",
  mitigated: "被害は抑えられる",
  blocked: "止められる",
  pending: "確認中",
  no_entry: "入口なし",
  out_of_scope: "対象外",
};

/** 一枚の描画に要るもの。経路図（diagram）は API で作ったときだけある */
export type OnePagerViewData = {
  onePager: OnePager;
  text: OnePagerResponse["text"];
  attackVersion: string;
  /** 入れた対策（ボタン）の名前 */
  appliedJa: string[];
  generatedAt: Date;
  diagram?: { graph: Graph; verdict: Verdict; profile: CompanyProfile; measures: MeasureDef[] };
  /** 共有リンクから開いた一枚（再計算していない旨を注記する） */
  fromShare?: boolean;
  /** 記事に入口が書かれておらず、型紙の入口候補で判定した一枚 */
  entryUnknown?: boolean;
  /** 同じ事故の複数の報を読んだとき：前の報から変わったこと（1〜2 文。プログラムが決定的に比べた固定の文） */
  changesJa?: string[];
};

export function viewDataFromResponse(
  r: OnePagerResponse,
  now: Date = new Date(),
  opts: { entryUnknown?: boolean } = {},
): OnePagerViewData {
  return {
    onePager: r.onePager,
    text: r.text,
    attackVersion: r.verdict.attackVersion,
    appliedJa: r.measures.map((m) => m.labelJa),
    generatedAt: now,
    diagram: { graph: r.graph, verdict: r.verdict, profile: r.profile, measures: r.measures },
    ...(opts.entryUnknown ? { entryUnknown: true } : {}),
    ...(r.changes && r.changes.summaryJa.length > 0 ? { changesJa: r.changes.summaryJa } : {}),
  };
}

export function viewDataFromShare(p: SharePayload): OnePagerViewData {
  const t = Date.parse(p.generatedAt);
  return {
    onePager: p.onePager,
    text: {
      source: p.text.source,
      ...(p.text.model ? { model: p.text.model } : {}),
      ...(p.text.noteJa ? { noteJa: p.text.noteJa } : {}),
    },
    attackVersion: p.attackVersion,
    appliedJa: p.appliedJa,
    generatedAt: Number.isNaN(t) ? new Date() : new Date(t),
    fromShare: true,
    ...(p.entryUnknown ? { entryUnknown: true } : {}),
    ...(p.changesJa && p.changesJa.length > 0 ? { changesJa: p.changesJa } : {}),
  };
}

/** 作成日時（共有リンクから開いたときは時刻まで：「いつ時点の判定か」を明記する） */
export function generatedAtJa(d: Date, withTime: boolean): string {
  const date = d.toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric" });
  if (!withTime) return date;
  return `${date} ${d.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}`;
}

type Props = {
  data: OnePagerViewData;
  measureLabel?: (mitigation: string) => string;
};

/**
 * 印刷・PDF で項目を切るときの「ほか N 件」。切る位置ごとに 1 つ置き、どれを出すかは詰め方の段（fit.ts、onepager.css）が決める。
 * 画面では出さない（全部の項目が見える）
 */
function MoreItems({ list, total }: { list: FitList; total: number }) {
  return (
    <>
      {cutPoints(list, total).map((keep) => (
        <li key={keep} className="op-more" data-keep={keep}>
          ほか {total - keep} 件
        </li>
      ))}
    </>
  );
}

export function OnePagerView({ data, measureLabel }: Props) {
  const { onePager: op, diagram, generatedAt } = data;
  // 2 ページに収まる詰め方の段を、描いたあとに測って紙へ付ける（印刷・PDF の規則だけが読む。画面の見た目は変わらない）
  const sheetRef = useRef<HTMLTableElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 一枚の内容（data）が変わったときに測り直す
  useEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    let alive = true;
    void (async () => {
      try {
        await document.fonts.ready;
        if (alive) await fitSheet(sheet);
      } catch {
        // 測れなくても、段 0（従来の印刷）のまま
      }
    })();
    return () => {
      alive = false;
    };
  }, [data]);
  const tone = RESULT_TONE[op.result];
  const maxDays = Math.max(1, ...op.stopped.map((s) => s.days));
  const deadlines = [...op.deadlines].sort((a, b) => a.day - b.day);
  const date = generatedAtJa(generatedAt, data.fromShare === true);
  const nums = sourceNumbers(op);
  const costNo = nums.n("ipa-sme-jirei-cost");
  const appliedNames = data.appliedJa;
  // 印刷の各ページの上下に出す走り見出し（紙では thead / tfoot がページごとに繰り返される。画面では出さない）
  const asOf = `${generatedAtJa(generatedAt, true)} 時点の判定${data.fromShare ? "（共有リンク）" : ""}`;
  // 2 枚目の先頭：金額の節（無ければ期限の節）。1 枚目は結論・何が起きるか（経路図）・止まる業務。
  // 経路図の無い一枚（共有リンク）は 1 枚目が短いので改ページを固定せず、節の途中で切れない範囲で続けて流す
  const hasMoney = op.revenueImpactJpy !== undefined || op.moneyLossJpy !== undefined;
  const pageBreak = (first: boolean) => (diagram && first ? " op-pb" : "");
  // 前の報から変わったこと（続報があるときだけ）。印刷では 1 枚目に数行足すので、経路図を少し小さくして 2 ページに収める
  const hasChanges = (data.changesJa?.length ?? 0) > 0;

  return (
    <table className="op-sheet" role="presentation" ref={sheetRef}>
      <thead>
        <tr>
          <td>
            <div className="op-run op-run-head" aria-hidden="true">
              <span>
                社長向けの一枚　<b>{op.companyName}</b>
                {op.fictional ? "（架空の会社）" : ""}
              </span>
              <span>{asOf}</span>
            </div>
          </td>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <article
              className={`op-paper tone-${tone}${hasChanges ? " op-has-changes" : ""}`}
              lang="ja"
            >
              <header className="op-head">
                <div className="op-kicker">
                  <span className="op-mono">社長向けの一枚</span>
                  {op.fictional && <span className="op-fiction">架空の会社</span>}
                </div>
                <h1 className="op-company">{op.companyName}</h1>
                <p className="op-meta">
                  {[
                    data.fromShare
                      ? `${date} 時点の判定（共有リンクで受け取った一枚）`
                      : `${date} 作成`,
                    `もとにした事例：${op.caseTitle || "公開された事例"}`,
                    ...(appliedNames.length > 0 ? [`入れた対策：${appliedNames.join("、")}`] : []),
                  ].join("　／　")}
                </p>
              </header>

              <section className="op-sec op-verdict">
                <div className="op-num">01</div>
                <h2 className="op-h">結論</h2>
                <p className="op-headline">{op.headlineJa}</p>
                <p className="op-sub">
                  報道と同じ攻撃が、いまの会社の構成に来たら：
                  <b className="op-word">{op.resultWordJa ?? RESULT_WORD[op.result]}</b>
                </p>
              </section>

              <section className="op-sec op-what">
                <div className="op-num">02</div>
                <h2 className="op-h">何が起きるか</h2>
                {diagram && (
                  <StaticDiagram
                    graph={diagram.graph}
                    verdict={diagram.verdict}
                    profile={diagram.profile}
                    applied={diagram.measures}
                    {...(measureLabel ? { measureLabel } : {})}
                  />
                )}
                <ol className="op-lines">
                  {op.whatHappensJa.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                  <MoreItems list="lines" total={op.whatHappensJa.length} />
                </ol>
                {hasChanges && data.changesJa && (
                  <p className="op-changed">
                    <b>前の報から変わったこと</b>
                    {data.changesJa.map((line) => (
                      <span key={line}>{line}</span>
                    ))}
                  </p>
                )}
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
                          <em
                            style={{ left: `${(100 * Math.min(s.manualDays, s.days)) / maxDays}%` }}
                          />
                        </div>
                        <p className="op-biz-note">
                          手作業で回せるのは {s.manualDays} 日まで
                          {s.partnerDay !== undefined && s.affectsJa
                            ? `。${s.partnerDay} 日目から${s.affectsJa}に影響`
                            : ""}
                        </p>
                      </li>
                    ))}
                    <MoreItems list="stopped" total={op.stopped.length} />
                  </ul>
                )}
                {op.partnerImpactJa && <p className="op-note">{op.partnerImpactJa}</p>}
              </section>

              {(op.revenueImpactJpy !== undefined || op.moneyLossJpy !== undefined) && (
                <section className={`op-sec op-money${pageBreak(true)}`}>
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

              <section className={`op-sec op-deadlines${pageBreak(!hasMoney)}`}>
                <div className="op-num">05</div>
                <h2 className="op-h">期限（起きた日を 0 日目として）</h2>
                {deadlines.length === 0 ? (
                  <p className="op-none">この攻撃では、届け出や連絡の期限は生じません。</p>
                ) : (
                  <>
                    <DeadlineAxis deadlines={deadlines} numbers={nums} />
                    <ol className="op-spine">
                      {deadlines.map((d) => {
                        const src = eventSourceId(d);
                        const n = nums.n(src);
                        return (
                          <li key={`${d.day}-${d.labelJa}`} className={`k-${d.kind}`}>
                            <span className="op-day">
                              <b>{d.day}</b>
                              <small>日目</small>
                            </span>
                            <span className="op-dl">
                              <span className="op-dl-kind">{KIND_JA[d.kind]}</span>
                              <span className="op-dl-label">
                                {d.labelJa}
                                {src && n && (
                                  <SourceRef id={src} n={n} titleJa={sourceTitle(src)} />
                                )}
                              </span>
                            </span>
                          </li>
                        );
                      })}
                      <MoreItems list="deadlines" total={deadlines.length} />
                    </ol>
                  </>
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
                              <b>
                                {yen(m.costJpy)}
                                {m.basis === "ipa" && costNo && (
                                  <SourceRef
                                    id="ipa-sme-jirei-cost"
                                    n={costNo}
                                    titleJa={sourceTitle("ipa-sme-jirei-cost")}
                                  />
                                )}
                              </b>
                              <span>{m.costJa.replace(/^[^（]*/, "")}</span>
                            </>
                          ) : (
                            <b className="soft">{m.costJa}</b>
                          )}
                        </p>
                        {m.requestToJa && <p className="op-card-to">依頼先：{m.requestToJa}</p>}
                      </li>
                    ))}
                    <MoreItems list="measures" total={op.measures.length} />
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
                {nums.ids.length > 0 && (
                  <ol className="op-src-n" aria-label="出典の番号">
                    {nums.ids.map((id, i) => (
                      <li key={id}>
                        <b>{i + 1}</b> {sourceTitle(id)}
                      </li>
                    ))}
                  </ol>
                )}
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
                  {data.entryUnknown && (
                    <li>
                      記事に攻撃の入口が書かれていないため、攻撃の型（型紙）の入口候補（VPN
                      装置、リモートデスクトップ、メールなど）で判定しています。別の入口から来る攻撃は含みません。
                    </li>
                  )}
                  {data.fromShare && (
                    <li>
                      出所：この一枚は共有リンクに含まれた内容をそのまま表示しています。判定は{" "}
                      {date}{" "}
                      時点のもので、開いた時点で再計算はしていません（会社の構成や対策がその後変わっていても反映されません）。会社カルテと経路図は共有リンクに含めていません。
                    </li>
                  )}
                </ul>
                <p className="op-all-sources">
                  <a href="#/sources">このツールのデータの扱いと出典はこちら</a>
                </p>
                <p className="op-brand">
                  ウチダイ　うちの会社は大丈夫か？　— 攻撃の段階の対応づけは MITRE ATT&amp;CK
                  Enterprise v{data.attackVersion}
                </p>
              </footer>
            </article>
          </td>
        </tr>
      </tbody>
      <tfoot>
        <tr>
          <td>
            <div className="op-run op-run-foot" aria-hidden="true">
              <span>ウチダイ　うちの会社は大丈夫か？</span>
              <span>MITRE ATT&amp;CK Enterprise v{data.attackVersion}</span>
            </div>
          </td>
        </tr>
      </tfoot>
    </table>
  );
}
