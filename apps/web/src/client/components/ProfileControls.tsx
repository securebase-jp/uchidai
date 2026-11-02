/**
 * 確認項目の一覧：資産ごとに緩和策を 1 行ずつ。「自分で答える」（質問表の選択肢をその場で出す）と「ベンダーに聞く」。
 * 根拠の優先順位を守る：外部確認は変更不可、ベンダー回答は確認してから、送信箱の回答は変更不可
 */
import { useState } from "react";
import type { AnswerInput, ControlChoice, ControlQuestion } from "../../shared/api.ts";
import { useRequests } from "../hooks/useRequests.tsx";
import { EVIDENCE_LABEL } from "../lib/labels.ts";
import {
  answerFromChoice,
  effectiveControl,
  isStale,
  overwritePolicy,
  plainQuestion,
  type StaffAnswer,
} from "../lib/profile.ts";
import type { CompanyProfile, LabelsFile, RoleDef } from "../lib/types.ts";

type Asset = CompanyProfile["assets"][number];

export const STATUS_LABEL = { present: "あり", absent: "なし", unknown: "未確認" } as const;
const STATUS_TONE = { present: "green", absent: "red", unknown: "amber" } as const;

export function formatWhen(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString("ja-JP", { year: "numeric", month: "numeric", day: "numeric" });
}

type Props = {
  profile: CompanyProfile;
  labels: LabelsFile;
  roles: RoleDef[];
  questions: ControlQuestion[];
  /** 送信箱から再適用される回答（表示と「変更不可」の判定に使う） */
  outboxAnswers: AnswerInput[];
  staff: string;
  now: Date;
  onAnswer(a: StaffAnswer): void;
  onProduct(assetId: string, product: string | undefined, version: string | undefined): void;
};

export function ProfileControls(p: Props) {
  const mit = (id: string) =>
    p.labels.mitigations[id] ?? p.labels.custom[id]?.labelJa ?? "（名称なし）";
  const roleLabel = (role: string) => p.roles.find((r) => r.id === role)?.labelJa ?? role;
  const questionFor = (id: string) =>
    p.questions.find((q) => q.mitigation === id) ?? plainQuestion(id, mit(id));
  return (
    <div className="stack">
      {p.profile.assets.map((a) => (
        <AssetCard
          key={a.id}
          asset={a}
          roleLabel={roleLabel(a.role)}
          mit={mit}
          questionFor={questionFor}
          outboxAnswers={p.outboxAnswers}
          staff={p.staff}
          now={p.now}
          onAnswer={p.onAnswer}
          onProduct={p.onProduct}
        />
      ))}
    </div>
  );
}

type CardProps = {
  asset: Asset;
  roleLabel: string;
  mit(id: string): string;
  questionFor(id: string): ControlQuestion;
  outboxAnswers: AnswerInput[];
  staff: string;
  now: Date;
  onAnswer(a: StaffAnswer): void;
  onProduct(assetId: string, product: string | undefined, version: string | undefined): void;
};

/** 製品名と版を入れる資産（判定ルールが版を見るのは入口の機器だけ） */
const PRODUCT_ROLES = new Set(["entry.vpn", "entry.rdp"]);

function AssetCard(p: CardProps) {
  const { asset } = p;
  const [product, setProduct] = useState(asset.product ?? "");
  const [version, setVersion] = useState(asset.version ?? "");
  const commitProduct = () => {
    if ((asset.product ?? "") === product.trim() && (asset.version ?? "") === version.trim())
      return;
    p.onProduct(asset.id, product, version);
  };
  return (
    <section className="asset-card" aria-label={asset.label}>
      <div className="ah">
        <h3>{asset.label}</h3>
        <span className="role">{p.roleLabel}</span>
      </div>
      {PRODUCT_ROLES.has(asset.role) && (
        <div className="fields" style={{ marginBottom: 6 }}>
          <label className="f">
            <span className="k">製品名</span>
            <input
              className="in"
              value={product}
              placeholder="例：機器のメーカー名と型番"
              onChange={(e) => setProduct(e.target.value)}
              onBlur={commitProduct}
            />
            <span className="h">
              製品名と版は Claude に送られません（判定はプログラムが行います）
            </span>
          </label>
          <label className="f">
            <span className="k">版（バージョン）</span>
            <input
              className="in"
              value={version}
              placeholder="例：7.0.14"
              onChange={(e) => setVersion(e.target.value)}
              onBlur={commitProduct}
            />
            <span className="h">
              版が未登録だと、更新の運用が未確認のときに「未確認」のままになります
            </span>
          </label>
        </div>
      )}
      {asset.controls.length === 0 ? (
        <p className="muted">この構成要素に確認する緩和策はありません。</p>
      ) : (
        asset.controls.map((c) => (
          <ControlRow
            key={c.mitigation}
            asset={asset}
            mitigation={c.mitigation}
            label={p.mit(c.mitigation)}
            question={p.questionFor(c.mitigation)}
            outboxAnswer={p.outboxAnswers.find(
              (x) => x.assetId === asset.id && x.mitigation === c.mitigation,
            )}
            staff={p.staff}
            now={p.now}
            onAnswer={p.onAnswer}
          />
        ))
      )}
    </section>
  );
}

type RowProps = {
  asset: Asset;
  mitigation: string;
  label: string;
  question: ControlQuestion;
  outboxAnswer: AnswerInput | undefined;
  staff: string;
  now: Date;
  onAnswer(a: StaffAnswer): void;
};

function ControlRow(p: RowProps) {
  const req = useRequests();
  const [mode, setMode] = useState<"closed" | "confirm" | "choose">("closed");
  const stored = p.asset.controls.find((c) => c.mitigation === p.mitigation);
  const ctl = effectiveControl(stored, p.outboxAnswer, p.mitigation);
  const policy = overwritePolicy(ctl, p.outboxAnswer);
  const stale = isStale(ctl.answeredAt, p.now);
  const key = `${p.asset.id}:${p.mitigation}`;
  const open = req.items.find(
    (r) => r.assetId === p.asset.id && r.mitigation === p.mitigation && !r.answer,
  );
  const locked = policy === "locked_external" || policy === "locked_outbox";

  const choose = (choice: ControlChoice) => {
    p.onAnswer(
      answerFromChoice(
        p.asset.id,
        p.question,
        choice,
        p.staff.trim() || "担当者",
        // 回答した時刻（now は半年経過の判定にだけ使う。画面を開いた時刻を回答日時にしない）
        new Date().toISOString(),
      ),
    );
    setMode("closed");
  };

  return (
    <div className="ctl-row">
      <div className="what">
        <b>
          {p.label} <code>{p.mitigation}</code>
        </b>
        <p className="q">{p.question.textJa}</p>
      </div>
      <div className="state">
        <span>
          <span className={`st ${STATUS_TONE[ctl.status]}`}>{STATUS_LABEL[ctl.status]}</span>
          {"　"}
          <span className={`st ${ctl.evidence === "none" ? "ink" : "ink"}`}>
            根拠：{ctl.status === "unknown" ? "未確認" : EVIDENCE_LABEL[ctl.evidence]}
          </span>
          {stale && (
            <>
              {" "}
              <span className="stale" title="回答から 180 日より前">
                半年以上経過。再確認を
              </span>
            </>
          )}
        </span>
        {(ctl.answeredBy || ctl.answeredAt) && (
          <span className="who">
            {ctl.answeredBy ?? ""}
            {ctl.answeredAt ? `　${formatWhen(ctl.answeredAt)}` : ""}
          </span>
        )}
        {ctl.noteJa && <span className="who">{ctl.noteJa}</span>}
      </div>
      <div className="actions">
        {locked ? (
          <span className="locked">
            {policy === "locked_external"
              ? "外部確認の結果が優先されます（担当者登録では変更できません）"
              : "送信箱のベンダー回答が優先されます（送信箱を空にすると変更できます）"}
          </span>
        ) : (
          <button
            type="button"
            className="btn sm"
            aria-expanded={mode !== "closed"}
            onClick={() =>
              setMode(
                mode !== "closed" ? "closed" : policy === "confirm_vendor" ? "confirm" : "choose",
              )
            }
          >
            自分で答える
          </button>
        )}
        {policy !== "locked_external" &&
          (open ? (
            <span className="st amber">依頼済み・回答待ち</span>
          ) : (
            <button
              type="button"
              className="btn sm"
              disabled={req.busyKey !== undefined}
              onClick={() => void req.create(p.asset.id, p.mitigation)}
            >
              {req.busyKey === key ? "依頼文を作成中…" : "ベンダーに聞く"}
            </button>
          ))}
      </div>
      {mode === "confirm" && (
        <div className="choice-box">
          <p className="confirm">
            この項目はベンダー回答（{ctl.answeredBy ?? "回答者不明"}
            {ctl.answeredAt ? `、${formatWhen(ctl.answeredAt)}` : ""}
            ）です。担当者登録で上書きすると、根拠はベンダー回答より弱い「担当者登録」になります。上書きしますか。
          </p>
          <p className="row" style={{ marginTop: 8 }}>
            <button type="button" className="btn sm primary" onClick={() => setMode("choose")}>
              上書きして答える
            </button>
            <button type="button" className="btn sm" onClick={() => setMode("closed")}>
              やめる
            </button>
          </p>
        </div>
      )}
      {mode === "choose" && (
        <section className="choice-box" aria-label={p.question.textJa}>
          <p className="question">{p.question.textJa}</p>
          {p.question.hintJa && <p className="hint">{p.question.hintJa}</p>}
          <div className="choices">
            {p.question.choices.map((c) => (
              <button
                type="button"
                key={c.id}
                className="opt-btn"
                aria-pressed={
                  ctl.status === c.status &&
                  (stored?.noteJa === c.labelJa || p.question.choices.length <= 3)
                }
                onClick={() => choose(c)}
              >
                {c.labelJa}
                <span className="muted">{STATUS_LABEL[c.status]}</span>
              </button>
            ))}
          </div>
          <p className="row" style={{ marginTop: 8 }}>
            <button type="button" className="btn sm ghost" onClick={() => setMode("closed")}>
              閉じる
            </button>
          </p>
        </section>
      )}
    </div>
  );
}
