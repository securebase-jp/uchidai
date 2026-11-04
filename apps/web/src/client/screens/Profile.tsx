/**
 * 会社カルテ（#/profile）：担当者が自社の詳細を画面から登録する。
 * 保存は useApp.setProfile 経由で localStorage に（サーバには送らない）。保存のたびに判定（/api/evaluate）が更新される。
 * 画面の文字は最小限にし、仕組みの説明は見出し横の情報ボタン（i）の中に出す
 */
import { useMemo, useState } from "react";
import { CompanyChoiceList } from "../components/CompanyPicker.tsx";
import { ConfirmDialog } from "../components/ConfirmDialog.tsx";
import { InfoButton } from "../components/InfoButton.tsx";
import {
  type ControlFilter,
  ProfileControls,
  visibleAssets,
} from "../components/ProfileControls.tsx";
import { ProfileFile } from "../components/ProfileFile.tsx";
import { BusinessTable, CompanyForm, PersonalDataTable } from "../components/ProfileForms.tsx";
import { ProgressRing } from "../components/ProgressRing.tsx";
import { useApp } from "../hooks/useApp.tsx";
import { AFFECTS_EXAMPLES } from "../lib/choices.ts";
import { type PendingItem, rankPending } from "../lib/pending.ts";
import {
  applyStaffAnswer,
  controlProgress,
  effectiveControl,
  isStale,
  setAssetProduct,
  setPersonalData,
  staffName,
  updateBusiness,
  updateCompany,
} from "../lib/profile.ts";
import type { CompanyProfile } from "../lib/types.ts";
import "../components/profile.css";

const FILTERS: [ControlFilter, string][] = [
  ["all", "すべて"],
  ["pending", "未確認だけ"],
  ["path", "この攻撃の経路に関係する項目だけ"],
];

/** 一覧の行へ移って最初のボタンに焦点を当てる（ハッシュ経路なのでアンカーは使えない） */
function jumpToRow(assetId: string, mitigation: string) {
  const row = document.getElementById(`ctl-${assetId}-${mitigation}`);
  row?.scrollIntoView({ behavior: "smooth", block: "center" });
  row?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
}

export function Profile() {
  const app = useApp();
  const { knowledge, profile, busy, error, answers, evaluation, theCase } = app;
  const [staff, setStaff] = useState(() => staffName.load());
  const [savedAt, setSavedAt] = useState<string>();
  const [filter, setFilter] = useState<ControlFilter>("all");
  const [confirmReset, setConfirmReset] = useState(false);
  const now = useMemo(() => new Date(), []);

  const save = (next: CompanyProfile) => {
    app.setProfile(next, app.profileSource ?? "saved");
    setSavedAt(new Date().toLocaleTimeString("ja-JP"));
  };

  // 未確認かどうかは、一覧の行と同じ見え方（送信箱のベンダー回答を重ねたもの）で決める
  const isPending = (assetId: string, c: CompanyProfile["assets"][number]["controls"][number]) =>
    effectiveControl(
      c,
      answers.find((x) => x.assetId === assetId && x.mitigation === c.mitigation),
      c.mitigation,
    ).status === "unknown";
  const progress = profile
    ? controlProgress(profile, answers)
    : { total: 0, unknown: 0, external: 0, vendor: 0, registered: 0, other: 0 };
  // いまの判定の経路で問われている未確認（答えると結論が変わりやすい順）。判定は engine の結果をそのまま使う
  const ranked = useMemo(
    () =>
      profile && !profile.fictional
        ? rankPending(evaluation?.profile ?? profile, evaluation?.verdict, evaluation?.graph)
        : [],
    [profile, evaluation],
  );
  const onPath = ranked.filter((x) => x.onPath);
  const mitLabel = (id: string) =>
    knowledge?.labels.mitigations[id] ?? knowledge?.labels.custom[id]?.labelJa ?? id;
  // 影響先の候補：いまの業種の構成パターンの例を先に、ほかの業種の例を続けて（重複は除く）
  const affectsExamples = useMemo(() => {
    const own = knowledge?.patterns.find((p) => p.id === profile?.pattern);
    const rest = (knowledge?.patterns ?? []).filter((p) => p !== own);
    const all = [own, ...rest]
      .flatMap((p) => p?.businesses ?? [])
      .map((b) => b.affectsJa)
      .filter((x): x is string => Boolean(x));
    return all.length > 0 ? [...new Set(all)] : AFFECTS_EXAMPLES;
  }, [knowledge, profile?.pattern]);
  const jumpTo = (x: PendingItem) => jumpToRow(x.assetId, x.mitigation);
  /** 「未確認 N 件」を押したら、いまの並びと絞り込みで最初に出ている未確認の行へ */
  const jumpToFirstPending = () => {
    if (!profile) return;
    for (const a of visibleAssets(profile.assets, onPath, filter, isPending)) {
      const c = a.controls.find((x) => isPending(a.id, x));
      if (c) return jumpToRow(a.id, c.mitigation);
    }
  };
  const staleCount = profile
    ? profile.assets.reduce(
        (n, a) => n + a.controls.filter((c) => isStale(c.answeredAt, now)).length,
        0,
      )
    : 0;

  return (
    <div className="profile">
      <div>
        <h1>
          会社カルテ
          <InfoButton title="会社カルテとは">
            <p>
              自社の構成と対策の有無を、担当者が自分で登録します。入力は数値と名前だけです。登録した内容はこのブラウザにだけ保存され、保存のたびに判定が更新されます。
            </p>
            <p>
              根拠は「外部確認」「ベンダー回答」「担当者登録」の順に強く扱います。未確認（分からない）は決して「止まる」とは扱いません。
            </p>
          </InfoButton>
        </h1>
        <p className="lead">自社の構成と対策の有無を登録します。保存先はこのブラウザだけです。</p>
        {profile && (
          <div className="summary" aria-live="polite">
            <ProgressRing progress={progress} onJump={jumpToFirstPending} />
            {staleCount > 0 && <span className="count amber">半年以上経過 {staleCount} 件</span>}
            {profile.fictional && <span className="chip fiction">架空の会社</span>}
            {busy ? (
              <span className="muted">判定しています…</span>
            ) : savedAt ? (
              <span className="saved">保存しました（{savedAt}）。判定を更新しました</span>
            ) : null}
            <a className="btn sm" href="#/staff">
              担当者画面で判定を見る
            </a>
          </div>
        )}
        {error && (
          <p className="err small" style={{ marginTop: 6 }}>
            {error}
          </p>
        )}
      </div>

      {!profile && (
        <div className="panel">
          <CompanyChoiceList />
          <p className="muted small" style={{ marginTop: 8 }}>
            最初の5問に答えると、役割の枠だけのカルテができます。書き出した JSON
            を読み込むこともできます。
          </p>
        </div>
      )}

      {profile && (
        <>
          <div className="panel">
            <h2>
              会社の情報
              <button
                type="button"
                className="btn ghost sm reset-btn"
                onClick={() => setConfirmReset(true)}
              >
                リセットする
              </button>
            </h2>
            <div className="fields">
              <label className="f">
                <span className="k">
                  登録する担当者のお名前
                  <InfoButton title="担当者のお名前">
                    <p>「自分で答える」の回答者として、日時とともに記録します。</p>
                  </InfoButton>
                </span>
                <input
                  className="in"
                  value={staff}
                  placeholder="例：情シス 田中"
                  onChange={(e) => {
                    setStaff(e.target.value);
                    staffName.save(e.target.value);
                  }}
                />
              </label>
            </div>
            <CompanyForm profile={profile} onChange={(f) => save(updateCompany(profile, f))} />
          </div>

          {onPath.length > 0 && (
            <div className="panel first-ask">
              <h2>
                まず答えるとよい項目（{onPath.length} 件）
                <InfoButton title="まず答えるとよい項目とは">
                  <p>
                    {theCase ? `事例「${theCase.title}」` : "いまの事例"}
                    の経路で、未確認のまま通っている段階の対策です。入口に近い順に並べています。
                  </p>
                  <p>
                    ここから答える（またはベンダーに聞く）と結論が変わりやすく、他の未確認はこの攻撃の結論には関わりません。
                  </p>
                </InfoButton>
              </h2>
              <ol className="first-ask-list">
                {onPath.map((x) => (
                  <li key={`${x.assetId}:${x.mitigation}`}>
                    <button type="button" className="link" onClick={() => jumpTo(x)}>
                      {x.assetLabel}：{mitLabel(x.mitigation)}
                    </button>
                    {x.stageJa && <span className="muted">　段階：{x.stageJa}</span>}
                  </li>
                ))}
              </ol>
            </div>
          )}

          <div>
            <div className="controls-head">
              <h2>
                確認項目
                <InfoButton title="確認項目の答え方">
                  <p>
                    構成要素ごとに、対策（ATT&amp;CK の緩和策）の有無を 1
                    行ずつ確かめます。各項目の質問は、項目名の横の情報ボタンか、「自分で答える」を押したときに出ます。
                  </p>
                  <p>
                    「自分で答える」はベンダーへの確認依頼と同じ 1
                    問の選択式です。選ぶとその場で保存し、根拠は「担当者登録」、回答者と日時を残します。
                  </p>
                  <p>
                    「ベンダーに聞く」は担当者画面の送信箱に確認依頼を作ります。回答が届くと根拠は「ベンダー回答」になります。
                  </p>
                </InfoButton>
              </h2>
              <fieldset className="tabbar">
                <legend className="visually-hidden">確認項目の絞り込み</legend>
                {FILTERS.map(([f, label]) => (
                  <button
                    type="button"
                    key={f}
                    className="tab"
                    aria-pressed={filter === f}
                    disabled={f === "path" && onPath.length === 0}
                    onClick={() => setFilter(f)}
                  >
                    {label}
                  </button>
                ))}
              </fieldset>
            </div>
            {knowledge ? (
              <ProfileControls
                profile={profile}
                labels={knowledge.labels}
                roles={knowledge.roles}
                questions={knowledge.controlQuestions}
                outboxAnswers={answers}
                onPath={onPath}
                filter={filter}
                staff={staff}
                now={now}
                onAnswer={(a) => save(applyStaffAnswer(profile, a))}
                onProduct={(id, product, version) =>
                  save(setAssetProduct(profile, id, product, version))
                }
                onKevApplied={(next) => save(next)}
              />
            ) : (
              <p className="muted">質問表を読み込んでいます…</p>
            )}
          </div>

          <div className="panel">
            <h2>
              業務の数値
              <InfoButton title="業務の数値の使いみち">
                <p>
                  業務が止まった日数と影響額の計算に使います。手作業で回せる日数、復旧にかかる日数、切り離したバックアップがあるときの復旧日数を入れてください。
                </p>
              </InfoButton>
            </h2>
            <BusinessTable
              businesses={profile.businesses}
              assetLabel={(id) => profile.assets.find((a) => a.id === id)?.label ?? id}
              affectsExamples={affectsExamples}
              onChange={(id, f) => save(updateBusiness(profile, id, f))}
            />
          </div>

          <div className="panel">
            <h2>
              個人情報（構成要素ごと）
              <InfoButton title="個人情報の使いみち">
                <p>
                  1,000
                  件を超える漏えいや、要配慮個人情報の漏えいは、個人情報保護委員会への報告義務の判定に使います。判定はプログラムが行います。
                </p>
              </InfoButton>
            </h2>
            <PersonalDataTable
              profileId={profile.id}
              assets={profile.assets}
              personalData={profile.personalData}
              onChange={(assetId, data) => save(setPersonalData(profile, assetId, data))}
            />
          </div>
        </>
      )}

      <ProfileFile profile={profile} onReplace={(p) => save(p)} />
      <ConfirmDialog
        open={confirmReset}
        title="カルテをリセットしますか？"
        confirmLabel="リセットする"
        onConfirm={() => {
          setConfirmReset(false);
          void app.resetProfile();
          setSavedAt(undefined);
        }}
        onCancel={() => setConfirmReset(false)}
      >
        {app.profileSource === "example" ? (
          <p>
            {profile?.companyName}
            のカルテへの変更を取り消して、はじめの内容に戻します。架空の会社なので、このブラウザに保存した自社のカルテには影響しません。
          </p>
        ) : (
          <p>
            登録した対策の有無、数値、会社名、個人情報の件数などを消して、最初の5問の回答から作った直後の状態に戻します。確認依頼の送信箱の回答は残ります。
          </p>
        )}
        <p>この操作は元に戻せません。必要なら先に「書き出し」で JSON を保存してください。</p>
      </ConfirmDialog>
    </div>
  );
}
