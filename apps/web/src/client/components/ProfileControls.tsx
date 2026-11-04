/**
 * 確認項目の一覧：資産ごとに対策（ATT&CK の緩和策）を 1 行ずつ。「自分で答える」（質問表の選択肢をその場で出す）と「ベンダーに聞く」。
 * 根拠の優先順位を守る：外部確認は変更不可、ベンダー回答は確認してから、送信箱の回答は変更不可。
 * 一覧には項目名と状態だけを出し、質問の文は項目名の横の情報ボタンか、開いたときに見せる
 */
import { useEffect, useState } from "react";
import type { AnswerInput, ControlChoice, ControlQuestion } from "../../shared/api.ts";
import { useRequests } from "../hooks/useRequests.tsx";
import { hostStatusLines } from "../lib/hostStatus.ts";
import type { KevMatch } from "../lib/kevApi.ts";
import {
  type KevProductOption,
  matchProductId,
  OTHER_PRODUCT,
  versionHint,
} from "../lib/kevProducts.ts";
import { EVIDENCE_LABEL } from "../lib/labels.ts";
import type { PendingItem } from "../lib/pending.ts";
import {
  answerFromChoice,
  effectiveControl,
  isStale,
  overwritePolicy,
  questionForRole,
  type StaffAnswer,
} from "../lib/profile.ts";
import type { CompanyProfile, Contradiction, LabelsFile, RoleDef } from "../lib/types.ts";
import { InfoButton } from "./InfoButton.tsx";
import { KevPanel } from "./KevPanel.tsx";
import { Field } from "./ProfileForms.tsx";

type Asset = CompanyProfile["assets"][number];
type Control = Asset["controls"][number];
/** 一覧の絞り込み：すべて／未確認だけ／この攻撃の経路に関係する項目だけ */
export type ControlFilter = "all" | "pending" | "path";

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
  /** いまの判定の経路で問われている未確認（入口に近い順）。該当する資産と行を先頭に寄せ、印を付ける */
  onPath?: PendingItem[];
  /** 一覧の絞り込み（既定はすべて） */
  filter?: ControlFilter;
  staff: string;
  now: Date;
  onAnswer(a: StaffAnswer): void;
  onProduct(assetId: string, product: string | undefined, version: string | undefined): void;
  /** 悪用確認済み脆弱性（KEV）との突き合わせを反映したカルテ（保存は呼び出し側） */
  onKevApplied?(profile: CompanyProfile, match: KevMatch, contradictions: Contradiction[]): void;
};

/** 経路で問われている資産を先頭に（資産の中では問われている行を先頭に）。それ以外の順は変えない */
export function orderByPath(assets: Asset[], onPath: PendingItem[]): Asset[] {
  if (onPath.length === 0) return assets;
  const assetRank = new Map<string, number>();
  const rowRank = new Map<string, number>();
  onPath.forEach((x, i) => {
    if (!assetRank.has(x.assetId)) assetRank.set(x.assetId, i);
    rowRank.set(`${x.assetId}:${x.mitigation}`, i);
  });
  const rank = (m: Map<string, number>, key: string) => m.get(key) ?? Number.POSITIVE_INFINITY;
  return assets
    .map((a, i) => ({ a, i }))
    .sort((x, y) => {
      const d = rank(assetRank, x.a.id) - rank(assetRank, y.a.id);
      return d !== 0 ? d : x.i - y.i;
    })
    .map(({ a }) => ({
      ...a,
      controls: a.controls
        .map((c, i) => ({ c, i }))
        .sort((x, y) => {
          const d =
            rank(rowRank, `${a.id}:${x.c.mitigation}`) - rank(rowRank, `${a.id}:${y.c.mitigation}`);
          return d !== 0 ? d : x.i - y.i;
        })
        .map(({ c }) => c),
    }));
}

/**
 * 絞り込み後に一覧へ出す資産と行（経路の順に並べたあと）。
 * 「未確認だけ」は isPending が真の行、「経路の項目だけ」は onPath にある行。行が残らない資産は出さない。「すべて」は並べ替えだけ
 */
export function visibleAssets(
  assets: Asset[],
  onPath: PendingItem[],
  filter: ControlFilter,
  isPending: (assetId: string, c: Control) => boolean,
): Asset[] {
  const ordered = orderByPath(assets, onPath);
  if (filter === "all") return ordered;
  const asked = new Set(onPath.map((x) => `${x.assetId}:${x.mitigation}`));
  return ordered
    .map((a) => ({
      ...a,
      controls: a.controls.filter((c) =>
        filter === "pending" ? isPending(a.id, c) : asked.has(`${a.id}:${c.mitigation}`),
      ),
    }))
    .filter((a) => a.controls.length > 0);
}

export function ProfileControls(p: Props) {
  const mit = (id: string) =>
    p.labels.mitigations[id] ?? p.labels.custom[id]?.labelJa ?? "（名称なし）";
  const roleLabel = (role: string) => p.roles.find((r) => r.id === role)?.labelJa ?? role;
  // 質問は資産の役割に合わせる（ホームページの M1047 は「改ざん検知」、サーバの M1047 は「アクセスログの監査」）
  const questionFor = (id: string, role: string) => questionForRole(p.questions, id, role, mit(id));
  const onPath = p.onPath ?? [];
  const pathStage = (assetId: string, mitigation: string) =>
    onPath.find((x) => x.assetId === assetId && x.mitigation === mitigation);
  const filter = p.filter ?? "all";
  const isPending = (assetId: string, c: Control) =>
    effectiveControl(
      c,
      p.outboxAnswers.find((x) => x.assetId === assetId && x.mitigation === c.mitigation),
      c.mitigation,
    ).status === "unknown";
  const shown = visibleAssets(p.profile.assets, onPath, filter, isPending);
  if (shown.length === 0)
    return (
      <p className="muted">
        {filter === "pending"
          ? "未確認の項目はありません。"
          : "この攻撃の経路で問われている未確認の項目はありません。"}
      </p>
    );
  return (
    <div className="stack">
      {shown.map((a) => (
        <AssetCard
          key={a.id}
          profile={p.profile}
          asset={a}
          roleLabel={roleLabel(a.role)}
          mit={mit}
          questionFor={questionFor}
          outboxAnswers={p.outboxAnswers}
          pathStage={pathStage}
          staff={p.staff}
          now={p.now}
          onAnswer={p.onAnswer}
          onProduct={p.onProduct}
          {...(p.onKevApplied ? { onKevApplied: p.onKevApplied } : {})}
        />
      ))}
    </div>
  );
}

type CardProps = {
  profile: CompanyProfile;
  asset: Asset;
  roleLabel: string;
  mit(id: string): string;
  questionFor(id: string, role: string): ControlQuestion;
  outboxAnswers: AnswerInput[];
  pathStage(assetId: string, mitigation: string): PendingItem | undefined;
  staff: string;
  now: Date;
  onAnswer(a: StaffAnswer): void;
  onProduct(assetId: string, product: string | undefined, version: string | undefined): void;
  onKevApplied?(profile: CompanyProfile, match: KevMatch, contradictions: Contradiction[]): void;
};

/**
 * 製品名と版を入れる資産（外部に面した入口の機器・サーバ）。
 * 判定ルールが版と knownExploited を見るのは VPN 装置だが、リモートデスクトップと社内に置いたホームページにも
 * 同じ属性（悪用確認済みの脆弱性に該当）を公開情報から付けられるようにする
 */
export const PRODUCT_ROLES = new Set(["entry.vpn", "entry.rdp", "entry.web"]);

/** 製品の選択肢（products.yaml）は重いので、製品名の欄が出るときに別の塊として読む。読めなければ自由記述の欄だけにする */
function useKevProducts(): KevProductOption[] | undefined {
  const [options, setOptions] = useState<KevProductOption[]>();
  useEffect(() => {
    let live = true;
    import("../lib/kevProductsData.ts")
      .then((m) => live && setOptions(m.kevProductOptions))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return options;
}

/**
 * 製品名と版。製品名は一覧から選ぶ（一覧にない製品は「その他」で自由記述）。版は文字の欄で、選んだ製品の書き方の例を出す。
 * すでに保存されている自由記述の製品名は、一覧の別名に当たれば選択状態に、当たらなければ「その他」と文字の欄で表す（保存の形は変えない）
 */
function ProductFields(p: {
  assetId: string;
  /** 保存されている製品名（選択の状態はこれで決める。入力中の文字で決めると、打っている途中で欄が切り替わる） */
  savedProduct: string;
  product: string;
  version: string;
  onProduct(v: string): void;
  onVersion(v: string): void;
  onCommit(product: string, version: string): void;
}) {
  const options = useKevProducts();
  const [otherMode, setOtherMode] = useState(false);
  const matchedId = options ? matchProductId(p.savedProduct, options) : undefined;
  const matched = options?.find((o) => o.id === matchedId);
  const choice = !options
    ? OTHER_PRODUCT
    : p.savedProduct.trim()
      ? (matchedId ?? OTHER_PRODUCT)
      : otherMode
        ? OTHER_PRODUCT
        : "";
  const { placeholder, noteJa } = versionHint(matched?.versionHintJa);
  const id = `prod-${p.assetId}`;
  return (
    <div className="fields" style={{ marginBottom: 6 }}>
      <Field
        label="製品名"
        htmlFor={`${id}-select`}
        info={
          <InfoButton title="製品名と版について">
            <p>製品名と版は Claude に送られません。判定はプログラムが行います。</p>
            <p>版が未登録だと、更新の運用が未確認のときに「未確認」のままになります。</p>
            <p>
              一覧にない製品は「その他」を選んで、メーカー名と型番を入れてください。一覧にある製品は、悪用確認済みの脆弱性との突き合わせに使えます。
            </p>
          </InfoButton>
        }
      >
        {options && (
          <select
            id={`${id}-select`}
            className="in sel"
            value={choice}
            onChange={(e) => {
              const v = e.target.value;
              const next = options.find((o) => o.id === v);
              if (next) {
                setOtherMode(false);
                p.onProduct(next.labelJa);
                p.onCommit(next.labelJa, p.version);
              } else {
                // 「その他」と「選んでください」は、いまの製品名を空に戻す（一覧の製品名を自由記述に持ち越さない）
                setOtherMode(v === OTHER_PRODUCT);
                p.onProduct("");
                p.onCommit("", p.version);
              }
            }}
          >
            <option value="">選んでください</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.labelJa}
              </option>
            ))}
            <option value={OTHER_PRODUCT}>その他（自由記述）</option>
          </select>
        )}
        {choice === OTHER_PRODUCT && (
          <input
            className="in"
            value={p.product}
            aria-label="製品名（自由記述）"
            placeholder="例：機器のメーカー名と型番"
            onChange={(e) => p.onProduct(e.target.value)}
            onBlur={() => p.onCommit(p.product, p.version)}
          />
        )}
      </Field>
      <Field
        label="版（バージョン）"
        htmlFor={`${id}-version`}
        {...(noteJa
          ? {
              info: (
                <InfoButton title="版の書き方">
                  <p>{noteJa}</p>
                </InfoButton>
              ),
            }
          : {})}
      >
        <input
          id={`${id}-version`}
          className="in"
          value={p.version}
          placeholder={placeholder}
          onChange={(e) => p.onVersion(e.target.value)}
          onBlur={() => p.onCommit(p.product, p.version)}
        />
      </Field>
    </div>
  );
}

function AssetCard(p: CardProps) {
  const { asset } = p;
  const [product, setProduct] = useState(asset.product ?? "");
  const [version, setVersion] = useState(asset.version ?? "");
  /** 製品名と版を保存する（変わっていなければ何もしない） */
  const commit = (nextProduct: string, nextVersion: string) => {
    if (
      (asset.product ?? "") === nextProduct.trim() &&
      (asset.version ?? "") === nextVersion.trim()
    )
      return;
    p.onProduct(asset.id, nextProduct, nextVersion);
  };
  return (
    <section className="asset-card" aria-label={asset.label}>
      <div className="ah">
        <h3>{asset.label}</h3>
        <span className="role">{p.roleLabel}</span>
      </div>
      {hostStatusLines(asset, p.now).map((l) => (
        <p key={l.labelJa} className="small" style={{ margin: "2px 0 4px" }}>
          <span className={`st ${l.tone}`}>{l.labelJa}</span>
          {l.detailJa && <span className="muted">　{l.detailJa}</span>}
        </p>
      ))}
      {PRODUCT_ROLES.has(asset.role) && (
        <ProductFields
          assetId={asset.id}
          savedProduct={asset.product ?? ""}
          product={product}
          version={version}
          onProduct={(v) => setProduct(v)}
          onVersion={(v) => setVersion(v)}
          onCommit={commit}
        />
      )}
      {PRODUCT_ROLES.has(asset.role) && p.onKevApplied && (
        <KevPanel
          profile={p.profile}
          assetId={asset.id}
          product={product}
          version={version}
          roleLabel={p.roleLabel}
          onApplied={p.onKevApplied}
        />
      )}
      {asset.controls.length === 0 ? (
        <p className="muted">この構成要素に確認する対策（ATT&amp;CK の緩和策）はありません。</p>
      ) : (
        asset.controls.map((c) => (
          <ControlRow
            key={c.mitigation}
            asset={asset}
            mitigation={c.mitigation}
            label={p.mit(c.mitigation)}
            question={p.questionFor(c.mitigation, asset.role)}
            outboxAnswer={p.outboxAnswers.find(
              (x) => x.assetId === asset.id && x.mitigation === c.mitigation,
            )}
            onPath={p.pathStage(asset.id, c.mitigation)}
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
  onPath: PendingItem | undefined;
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

  // 5問の「クラウド同期」「同じネットワーク内」は M1053 が「あり」でも切り離していない（文言が無いので補う）
  const isolatedNote =
    p.mitigation === "M1053" && !ctl.noteJa && p.asset.attrs.isolated === false
      ? "切り離した保管先ではない（同じネットワーク内かクラウド同期）"
      : undefined;
  return (
    <div className="ctl-row" id={`ctl-${p.asset.id}-${p.mitigation}`}>
      <div className="what">
        <div className="name">
          <b>
            {p.label} <code>{p.mitigation}</code>
          </b>
          <InfoButton title={p.label}>
            <p>{p.question.textJa}</p>
            {p.question.hintJa && <p>{p.question.hintJa}</p>}
          </InfoButton>
        </div>
        {p.onPath && (
          <span className="chip on-path">
            この攻撃の経路{p.onPath.stageJa ? `：${p.onPath.stageJa}` : ""}
          </span>
        )}
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
        {isolatedNote && <span className="who">{isolatedNote}</span>}
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
