/** 担当者向けの根拠：手法と ID、対策（ATT&CK の緩和策）、根拠、記事中の根拠文、矛盾、未確認の一覧 */
import { useMemo } from "react";
import { kevHints } from "../lib/kevHints.ts";
import { EVIDENCE_LABEL, SOURCE_LABEL, STATE_LABEL, STATE_TONE } from "../lib/labels.ts";
import { pathTemplateLabel, type TemplateRef } from "../lib/pending.ts";
import { reconHints } from "../lib/reconHints.ts";
import type { Case, CompanyProfile, LabelsFile, Verdict } from "../lib/types.ts";
import { InfoButton } from "./InfoButton.tsx";

type Props = {
  verdict: Verdict;
  theCase: Case;
  profile: CompanyProfile;
  labels: LabelsFile;
  graph: { nodes: { id: string; label: string; assetId?: string | undefined }[] };
  /** 型紙の名前（複数の型紙を展開したときに経路ごとの見出しに出す） */
  templates?: TemplateRef[];
};

export function EvidencePanel({ verdict, theCase, profile, labels, graph, templates }: Props) {
  const nodeLabel = (id: string) => graph.nodes.find((n) => n.id === id)?.label ?? id;
  // 型紙を 1 本に絞れなかった（verdict.templateId が無い）ときだけ、経路ごとに型紙の名前を出す
  const multiTemplate =
    !verdict.templateId &&
    new Set(verdict.paths.filter((p) => p.source !== "ai").map((p) => p.templateId)).size > 1;
  const mit = (id: string) => labels.mitigations[id] ?? labels.custom[id]?.labelJa ?? "";
  // 外部確認（#/domain）で見つかった矛盾。反映したカルテの id と一致するものだけ。判定（engine）の矛盾と同じ欄に出す
  const external = useMemo(() => {
    const h = reconHints.load()?.contradictions;
    return h && h.profileId === profile.id ? h : undefined;
  }, [profile.id]);
  const engineMessages = new Set(verdict.contradictions.map((c) => c.messageJa));
  // 廃止済み資産の残存は engine がカルテの属性から出すので、同じ資産の外部確認由来の行は重ねない
  const engineDecommissioned = new Set(
    verdict.contradictions.filter((c) => c.messageJa.includes("廃止済み")).map((c) => c.assetId),
  );
  const externalOnly = (external?.items ?? []).filter(
    (c) =>
      !engineMessages.has(c.messageJa) &&
      !(c.messageJa.includes("廃止済み") && engineDecommissioned.has(c.assetId)),
  );
  // KEV との突き合わせ（#/profile）で出た矛盾。反映したカルテの id と一致するものだけ（判定の矛盾と重なるものは除く）
  const kevContradictions = kevHints
    .contradictionsFor(profile.id)
    .filter((c) => !engineMessages.has(c.messageJa));
  /** 公開情報（CISA KEV）で判定した資産の出典の一行。根拠の欄に出す */
  const kevSourceOf = (nodeId: string): string | undefined => {
    const assetId = graph.nodes.find((n) => n.id === nodeId)?.assetId;
    const a = assetId ? profile.assets.find((x) => x.id === assetId) : undefined;
    if (a?.attrEvidence.knownExploited !== "external" || a.attrs.kevCatalogVersion === undefined)
      return undefined;
    const cves = typeof a.attrs.kevCves === "string" ? a.attrs.kevCves.replaceAll(",", "、") : "";
    return `公開情報：CISA KEV（カタログ版 ${String(a.attrs.kevCatalogVersion)}${cves ? `、${cves}` : "、該当なし"}）`;
  };
  const pending = profile.assets.flatMap((a) =>
    a.controls
      .filter((c) => c.status === "unknown")
      .map((c) => ({ asset: a.label, mitigation: c.mitigation, noteJa: c.noteJa })),
  );
  return (
    <div className="stack">
      <h2 className="staff-h">
        根拠
        <InfoButton title="根拠の読み方">
          <p>
            判定に使った経路を、段階ごとに並べます。段階の名前は攻撃の型（型紙）の見出しで、手法は
            MITRE ATT&amp;CK の名前と ID
            です。判定の色と語は、止まる・復旧できる・未確認・人次第・突破される の 5 つです。
          </p>
          <p>
            「効く対策」はその段階で効く ATT&amp;CK
            の緩和策、「効かない対策」は入れてもこの経路では効かない緩和策と
            その理由です。「根拠」は、その段階の判定の材料がどこから来たか（外部確認・ベンダー回答・担当者登録・
            根拠なし）と、記事に書いてある段階か推定した段階かを示します。記事中の根拠文は、Claude
            が読み取った引用をそのまま載せています。
          </p>
          <p>
            矛盾は、外部確認や公開情報と登録内容の食い違いです。未確認は、確認依頼の候補になる項目です。
          </p>
        </InfoButton>
      </h2>
      {theCase.suspiciousInstructions.length > 0 && (
        <div className="panel warn">
          <h2>注意：記事の中に指示らしき文がありました（判定には使っていません）</h2>
          {theCase.suspiciousInstructions.map((s) => (
            <p key={s} className="quote">
              {s}
            </p>
          ))}
        </div>
      )}
      {verdict.paths.map((p) => (
        <div className="panel" key={p.id}>
          <h2>
            経路 {p.id}
            {" ／ "}
            {SOURCE_LABEL[p.source]}
            {" ／ "}
            {p.reachedCore ? "中核システムまで届く" : "途中で止まる"}
            {multiTemplate && templates && pathTemplateLabel(p, templates) && (
              <>
                {" ／ "}
                攻撃の型（型紙）「{pathTemplateLabel(p, templates)}」
              </>
            )}
          </h2>
          <ol className="ev-cards">
            {p.steps.map((s, i) => {
              const kev = kevSourceOf(s.nodeId);
              return (
                <li
                  className={`ev-card tone-${STATE_TONE[s.state]}`}
                  key={`${s.stageId ?? s.labelJa ?? ""}-${s.nodeId}-${s.technique ?? ""}-${s.tactic}`}
                >
                  <div className="ev-head">
                    <span className="ev-n">{i + 1}</span>
                    <b className="ev-stage">
                      {s.labelJa ?? s.stageId ?? ""}
                      {s.precondition ? "（前提）" : ""}
                    </b>
                    <span className={`st ${STATE_TONE[s.state]}`}>
                      {(s.state === "breached" && s.breachedLabelJa) || STATE_LABEL[s.state]}
                    </span>
                  </div>
                  {s.branch && <p className="muted small">枝：止まっても本線は進む</p>}
                  <dl className="ev-body">
                    <dt>自社の構成要素</dt>
                    <dd>{nodeLabel(s.nodeId)}</dd>
                    <dt>手法</dt>
                    <dd>
                      {s.technique ? (
                        <>
                          {labels.techniques[s.technique] ?? ""}（<code>{s.technique}</code>）
                        </>
                      ) : (
                        <span className="muted">（手法なし）</span>
                      )}
                      <br />
                      <span className="muted">
                        {labels.tactics[s.tactic] ?? ""}（<code>{s.tactic}</code>）
                      </span>
                    </dd>
                    {s.mitigations.length > 0 && (
                      <>
                        <dt>{i === 0 ? "効く対策（ATT&CK の緩和策）" : "効く対策"}</dt>
                        <dd>
                          {s.mitigations.map((m) => (
                            <div key={m}>
                              {mit(m)}（<code>{m}</code>）
                            </div>
                          ))}
                        </dd>
                      </>
                    )}
                    {s.ineffective.length > 0 && (
                      <>
                        <dt>効かない対策</dt>
                        <dd>
                          {s.ineffective.map((m) => (
                            <div key={m.mitigation}>
                              <span className="fx-red">
                                {mit(m.mitigation)}（<code>{m.mitigation}</code>）
                              </span>{" "}
                              <span className="muted">{m.reasonJa}</span>
                            </div>
                          ))}
                        </dd>
                      </>
                    )}
                    <dt>根拠</dt>
                    <dd>
                      {EVIDENCE_LABEL[s.evidence]}・{SOURCE_LABEL[s.source]}
                      {kev && (
                        <>
                          <br />
                          <span className="muted">{kev}</span>
                        </>
                      )}
                      {s.ruleId && (
                        <>
                          <br />
                          <code className="muted">{s.ruleId}</code>
                        </>
                      )}
                    </dd>
                    {(s.reasonJa || s.quote) && (
                      <>
                        <dt>理由</dt>
                        <dd>
                          {s.reasonJa}
                          {s.quote && <p className="quote">「{s.quote.replace(/\s+/g, "")}」</p>}
                        </dd>
                      </>
                    )}
                  </dl>
                </li>
              );
            })}
          </ol>
        </div>
      ))}
      <div className="grid-2">
        <div className="panel">
          <h2>矛盾（外部確認と登録内容の食い違い）</h2>
          {verdict.contradictions.length === 0 &&
          externalOnly.length === 0 &&
          kevContradictions.length === 0 ? (
            <p className="muted">なし</p>
          ) : (
            <>
              {verdict.contradictions.map((c) => (
                <p key={`${c.assetId}-${c.messageJa}`} className="small">
                  <span className="chip">判定</span> <b>{nodeLabel(c.assetId)}</b>：{c.messageJa}
                  （外部：{c.external}／登録：{c.registered}）
                </p>
              ))}
              {externalOnly.map((c) => (
                <p key={`ext-${c.assetId}-${c.messageJa}`} className="small">
                  <span
                    className="chip"
                    title={`外部確認の結果を反映した日時：${external?.appliedAt ?? ""}`}
                  >
                    外部確認
                  </span>{" "}
                  <b>{nodeLabel(c.assetId)}</b>：{c.messageJa}（外部：{c.external}／登録：
                  {c.registered}）
                </p>
              ))}
              {kevContradictions.map((c) => (
                <p key={`kev-${c.assetId}-${c.messageJa}`} className="small">
                  <span className="chip" title={`突き合わせた日時：${c.checkedAt}`}>
                    公開情報（KEV）
                  </span>{" "}
                  <b>{nodeLabel(c.assetId)}</b>：{c.messageJa}（公開情報：{c.external}／登録：
                  {c.registered}）
                </p>
              ))}
            </>
          )}
        </div>
        <div className="panel">
          <h2>未確認（確認依頼の候補）</h2>
          {pending.length === 0 ? (
            <p className="muted">なし</p>
          ) : (
            pending.map((x) => (
              <p key={`${x.asset}-${x.mitigation}`} className="small">
                <b>{x.asset}</b>　{mit(x.mitigation)}（<code>{x.mitigation}</code>）
                {x.noteJa ? <span className="muted">　{x.noteJa}</span> : null}
              </p>
            ))
          )}
        </div>
      </div>
      <div className="panel">
        <h2>
          記事から読み取った段階
          <InfoButton title="読解と判定の分担">
            <p>
              この表は Claude
              が記事から読み取った段階です。記事は信頼できないデータとして指示文と分けて渡し、
              出力はプログラムが検証して、存在しない手法 ID
              や攻撃の型（型紙）にない手法は捨てています。
              「記載」は記事に書いてある段階、「推定」は記事に明記がなく Claude が推定した段階です。
            </p>
            <p>
              判定そのもの（どの段階で止まるか、日数、金額、期限）は Claude
              ではなくプログラムが決めています。
            </p>
          </InfoButton>
        </h2>
        <table className="evidence stacked">
          <thead>
            <tr>
              <th>戦術</th>
              <th>手法</th>
              <th>記事に書いてある／推定</th>
              <th>要約と根拠文</th>
            </tr>
          </thead>
          <tbody>
            {theCase.steps.map((s) => (
              <tr key={`${s.tactic}-${s.techniques.join(",")}-${s.quote ?? s.summaryJa ?? ""}`}>
                <td data-label="戦術">
                  {labels.tactics[s.tactic] ?? ""}（<code>{s.tactic}</code>）
                </td>
                <td data-label="手法">
                  {s.techniques.map((t) => (
                    <div key={t}>
                      {labels.techniques[t] ?? ""}（<code>{t}</code>）
                    </div>
                  ))}
                </td>
                <td data-label="記事に書いてある／推定">
                  {s.source === "stated"
                    ? "記事に書いてある"
                    : s.source === "inferred"
                      ? "推定"
                      : "不明"}
                </td>
                <td data-label="要約と根拠文">
                  {s.summaryJa}
                  {s.quote && <p className="quote">「{s.quote.replace(/\s+/g, "")}」</p>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
