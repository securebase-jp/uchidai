/**
 * 一般的な AI の回答と並べる枠：知見ファイルを渡さない Claude が挙げた対策を、
 * ウチダイの判定ルールで「この攻撃に効く／効かない（理由つき）／この攻撃には関係しない」の 3 列に振り分けて見せる
 */
import { useAiAttacker } from "../hooks/useAiAttacker.tsx";
import { useApp } from "../hooks/useApp.tsx";
import type { ComparedMitigation } from "../lib/attackerApi.ts";
import { InfoButton } from "./InfoButton.tsx";
import "./ai-attacker.css";

function Item({
  m,
  kind,
}: {
  m: ComparedMitigation;
  kind: "effective" | "ineffective" | "outside";
}) {
  return (
    <div className="cmp-item">
      <span className="name">{m.nameJa}</span>{" "}
      {m.mitigation && (
        <span className="muted">
          {m.labelJa}（<code>{m.mitigation}</code>）
        </span>
      )}
      <span className="who">一般的な AI：{m.reasonJa}</span>
      {kind === "effective" && (
        <span className="who green">
          ウチダイ：<b>効く</b>（{m.stageLabelJa} の段階）
        </span>
      )}
      {kind === "ineffective" && (
        <span className="who red">
          ウチダイ：<b>この経路では効かない</b>（{m.stageLabelJa}）：{m.verdictReasonJa}
        </span>
      )}
      {kind === "outside" && (
        <span className="who">
          ウチダイ：<b>この攻撃には関係しない</b>
          {m.mitigation
            ? "（この攻撃の段階に当たらない）"
            : "（対策（ATT&CK の緩和策）の ID に対応づけできない）"}
        </span>
      )}
    </div>
  );
}

export function ComparisonPanel() {
  const app = useApp();
  const ai = useAiAttacker();
  const c = ai.comparison;
  return (
    <div className="panel cmp">
      <h2>
        一般的な AI の回答と並べる
        <InfoButton title="この比較について">
          <p>
            知見ファイル（攻撃の型（型紙）・判定ルール表）を渡さない Claude
            に同じ事例の対策を挙げさせ、ウチダイの判定ルールで「この攻撃に効く」「効かない」「この攻撃には関係しない」
            に振り分けます。対策ボタンを押すと、いまの判定で振り分け直します。
          </p>
          <p>
            一般的な回答が間違いというわけではなく、御社の構成とこの攻撃の経路に当てはめると、どれが先に効くかが
            分かる、という比較です。
          </p>
        </InfoButton>
      </h2>
      <div className="row" style={{ marginTop: 8 }}>
        <button
          type="button"
          className="btn"
          onClick={() => void ai.runCompare()}
          disabled={ai.compareBusy || !app.evaluation}
        >
          {ai.compareBusy
            ? "取り寄せています…"
            : c
              ? "もう一度取り寄せる"
              : "一般的な AI の回答を取り寄せる"}
        </button>
        {ai.compareRecorded === true && (
          <span className="chip">
            記録の再生（実際の出力の記録
            {ai.compareMeta?.recordedAt ? `、${ai.compareMeta.recordedAt.slice(0, 10)}` : ""}）
          </span>
        )}
        {ai.compareRecorded === false && ai.compareMeta?.model && (
          <span className="chip">いま実行（{ai.compareMeta.model}）</span>
        )}
        {c && (
          <span className="muted small">
            {c.counts.total} 件：効く {c.counts.effective}、効かない {c.counts.ineffective}
            、この攻撃には関係しない {c.counts.outside + c.counts.unmapped}
          </span>
        )}
      </div>
      {ai.compareError && (
        <p className="err small" style={{ marginTop: 6 }}>
          {ai.compareError}
        </p>
      )}
      {c && (
        <div className="cmp-cols">
          <div className="cmp-col green">
            <h3>
              この攻撃に効く <span className="n">{c.counts.effective}</span>
            </h3>
            {c.effective.map((m) => (
              <Item key={`${m.mitigation}-${m.nameJa}`} m={m} kind="effective" />
            ))}
            {c.effective.length === 0 && <p className="muted small">なし</p>}
          </div>
          <div className="cmp-col red">
            <h3>
              この攻撃では効かない <span className="n">{c.counts.ineffective}</span>
            </h3>
            {c.ineffective.map((m) => (
              <Item key={`${m.mitigation}-${m.nameJa}`} m={m} kind="ineffective" />
            ))}
            {c.ineffective.length === 0 && <p className="muted small">なし</p>}
          </div>
          <div className="cmp-col ink">
            <h3>
              この攻撃には関係しない{" "}
              <span className="n">{c.counts.outside + c.counts.unmapped}</span>
            </h3>
            {[...c.outside, ...c.unmapped].map((m) => (
              <Item key={`${m.mitigation ?? "-"}-${m.nameJa}`} m={m} kind="outside" />
            ))}
            {c.outside.length + c.unmapped.length === 0 && <p className="muted small">なし</p>}
          </div>
        </div>
      )}
    </div>
  );
}
