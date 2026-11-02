/** 担当者向けの根拠：手法 ID、緩和策 ID、根拠の種類、記事中の根拠文、矛盾、未確認の一覧 */
import { useMemo } from "react";
import { EVIDENCE_LABEL, SOURCE_LABEL, STATE_LABEL, STATE_TONE } from "../lib/labels.ts";
import { pathTemplateLabel, type TemplateRef } from "../lib/pending.ts";
import { reconHints } from "../lib/reconHints.ts";
import type { Case, CompanyProfile, LabelsFile, Verdict } from "../lib/types.ts";

type Props = {
  verdict: Verdict;
  theCase: Case;
  profile: CompanyProfile;
  labels: LabelsFile;
  graph: { nodes: { id: string; label: string }[] };
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
  const externalOnly = (external?.items ?? []).filter((c) => !engineMessages.has(c.messageJa));
  const pending = profile.assets.flatMap((a) =>
    a.controls
      .filter((c) => c.status === "unknown")
      .map((c) => ({ asset: a.label, mitigation: c.mitigation, noteJa: c.noteJa })),
  );
  return (
    <div className="stack">
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
            経路 {p.id}　{SOURCE_LABEL[p.source]}　{p.reachedCore ? "中核に到達" : "途中で止まる"}
            {multiTemplate && templates && pathTemplateLabel(p, templates) && (
              <>　型紙「{pathTemplateLabel(p, templates)}」</>
            )}
          </h2>
          <div style={{ overflowX: "auto" }}>
            <table className="evidence">
              <thead>
                <tr>
                  <th>段階</th>
                  <th>自社の構成要素</th>
                  <th>手法</th>
                  <th>判定</th>
                  <th>効く緩和策</th>
                  <th>効かない緩和策</th>
                  <th>由来</th>
                  <th>根拠の種類</th>
                  <th>理由と記事中の根拠文</th>
                </tr>
              </thead>
              <tbody>
                {p.steps.map((s) => (
                  <tr
                    key={`${s.stageId ?? s.labelJa ?? ""}-${s.nodeId}-${s.technique ?? ""}-${s.tactic}`}
                  >
                    <td>
                      {s.labelJa ?? s.stageId ?? ""}
                      {s.precondition ? "（前提）" : ""}
                      {s.branch && (
                        <>
                          <br />
                          <span className="muted">（枝：止まっても本線は進む）</span>
                        </>
                      )}
                    </td>
                    <td>{nodeLabel(s.nodeId)}</td>
                    <td>
                      {s.technique ? (
                        <>
                          <code>{s.technique}</code>
                          <br />
                          <span className="muted">{labels.techniques[s.technique] ?? ""}</span>
                        </>
                      ) : (
                        <span className="muted">（手法なし）</span>
                      )}
                      <br />
                      <span className="muted">
                        <code>{s.tactic}</code> {labels.tactics[s.tactic] ?? ""}
                      </span>
                    </td>
                    <td>
                      <span className={`st ${STATE_TONE[s.state]}`}>{STATE_LABEL[s.state]}</span>
                      {s.ruleId && (
                        <>
                          <br />
                          <code className="muted">{s.ruleId}</code>
                        </>
                      )}
                    </td>
                    <td>
                      {s.mitigations.map((m) => (
                        <div key={m}>
                          <code>{m}</code> <span className="muted">{mit(m)}</span>
                        </div>
                      ))}
                    </td>
                    <td>
                      {s.ineffective.map((m) => (
                        <div key={m.mitigation}>
                          <code className="fx-red">{m.mitigation}</code>{" "}
                          <span className="muted">{m.reasonJa}</span>
                        </div>
                      ))}
                    </td>
                    <td>{SOURCE_LABEL[s.source]}</td>
                    <td>{EVIDENCE_LABEL[s.evidence]}</td>
                    <td>
                      {s.reasonJa}
                      {s.quote && <p className="quote">「{s.quote.replace(/\s+/g, "")}」</p>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      <div className="grid-2">
        <div className="panel">
          <h2>矛盾（外部確認と登録内容の食い違い）</h2>
          {verdict.contradictions.length === 0 && externalOnly.length === 0 ? (
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
                <b>{x.asset}</b>　<code>{x.mitigation}</code> {mit(x.mitigation)}
                {x.noteJa ? <span className="muted">　{x.noteJa}</span> : null}
              </p>
            ))
          )}
        </div>
      </div>
      <div className="panel">
        <h2>記事から読み取った段階（Claude の読解。判定はプログラム）</h2>
        <table className="evidence">
          <thead>
            <tr>
              <th>戦術</th>
              <th>手法</th>
              <th>記載／推定</th>
              <th>要約と根拠文</th>
            </tr>
          </thead>
          <tbody>
            {theCase.steps.map((s) => (
              <tr key={`${s.tactic}-${s.techniques.join(",")}-${s.quote ?? s.summaryJa ?? ""}`}>
                <td>
                  <code>{s.tactic}</code> {labels.tactics[s.tactic] ?? ""}
                </td>
                <td>
                  {s.techniques.map((t) => (
                    <div key={t}>
                      <code>{t}</code> <span className="muted">{labels.techniques[t] ?? ""}</span>
                    </div>
                  ))}
                </td>
                <td>
                  {s.source === "stated" ? "記載" : s.source === "inferred" ? "推定" : "不明"}
                </td>
                <td>
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
