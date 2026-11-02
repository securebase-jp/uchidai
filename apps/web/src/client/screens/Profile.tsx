/**
 * 会社カルテ（#/profile）：担当者が自社の詳細を画面から登録する。
 * 保存は useApp.setProfile 経由で localStorage に（サーバには送らない）。保存のたびに判定（/api/evaluate）が更新される
 */
import { useMemo, useState } from "react";
import { ProfileControls } from "../components/ProfileControls.tsx";
import { ProfileFile } from "../components/ProfileFile.tsx";
import { BusinessTable, CompanyForm, PersonalDataTable } from "../components/ProfileForms.tsx";
import { useApp } from "../hooks/useApp.tsx";
import {
  applyStaffAnswer,
  isStale,
  pendingCount,
  setAssetProduct,
  setPersonalData,
  staffName,
  updateBusiness,
  updateCompany,
} from "../lib/profile.ts";
import type { CompanyProfile } from "../lib/types.ts";
import "../components/profile.css";

export function Profile() {
  const app = useApp();
  const { knowledge, profile, busy, error, answers } = app;
  const [staff, setStaff] = useState(() => staffName.load());
  const [savedAt, setSavedAt] = useState<string>();
  const now = useMemo(() => new Date(), []);

  const save = (next: CompanyProfile) => {
    app.setProfile(next, app.profileSource ?? "saved");
    setSavedAt(new Date().toLocaleTimeString("ja-JP"));
  };

  const pending = profile ? pendingCount(profile) : 0;
  const staleCount = profile
    ? profile.assets.reduce(
        (n, a) => n + a.controls.filter((c) => isStale(c.answeredAt, now)).length,
        0,
      )
    : 0;

  return (
    <div className="profile">
      <div>
        <h1>会社カルテ</h1>
        <p className="lead">
          自社の構成と対策の有無を、担当者が自分で登録します。入力は数値と名前だけ。登録した内容はこのブラウザにだけ保存され、保存のたびに判定が更新されます。
          根拠は「外部確認 ＞ ベンダー回答 ＞
          担当者登録」の順に強く、未確認（分からない）は決して「止まる」とは扱いません。
        </p>
        {profile && (
          <div className="summary" aria-live="polite">
            <span className={`count ${pending > 0 ? "amber" : "green"}`}>未確認 {pending} 件</span>
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
          <h2>会社カルテがありません</h2>
          <p className="muted">
            最初の5問に答えると、役割の枠だけのカルテができます。詳細はこの画面で登録します。書き出した
            JSON を読み込むこともできます。
          </p>
          <p className="row" style={{ marginTop: 8 }}>
            <a className="btn primary" href="#/questions">
              最初の5問に答える
            </a>
            <button
              type="button"
              className="btn"
              onClick={() => void app.loadExample("demo-seiko")}
            >
              架空の会社（デモ精工）で試す
            </button>
          </p>
        </div>
      )}

      {profile && (
        <>
          <div className="panel">
            <h2>会社の情報</h2>
            <div className="fields">
              <label className="f">
                <span className="k">登録する担当者のお名前</span>
                <input
                  className="in"
                  value={staff}
                  placeholder="例：情シス 田中"
                  onChange={(e) => {
                    setStaff(e.target.value);
                    staffName.save(e.target.value);
                  }}
                />
                <span className="h">「自分で答える」の回答者として、日時とともに記録します</span>
              </label>
            </div>
            <CompanyForm profile={profile} onChange={(f) => save(updateCompany(profile, f))} />
          </div>

          <div>
            <h2 style={{ fontSize: 17, margin: "4px 0 8px" }}>
              確認項目（構成要素ごとの対策の有無）
            </h2>
            <p className="muted" style={{ marginBottom: 8 }}>
              「自分で答える」はベンダーへの確認依頼と同じ 1
              問の選択式です。選ぶとその場で保存し、根拠は「担当者登録」、回答者と日時を残します。
              「ベンダーに聞く」は担当者画面の送信箱に確認依頼を作ります（回答が届くと根拠は「ベンダー回答」になります）。
            </p>
            {knowledge ? (
              <ProfileControls
                profile={profile}
                labels={knowledge.labels}
                roles={knowledge.roles}
                questions={knowledge.controlQuestions}
                outboxAnswers={answers}
                staff={staff}
                now={now}
                onAnswer={(a) => save(applyStaffAnswer(profile, a))}
                onProduct={(id, product, version) =>
                  save(setAssetProduct(profile, id, product, version))
                }
              />
            ) : (
              <p className="muted">質問表を読み込んでいます…</p>
            )}
          </div>

          <div className="panel">
            <h2>業務の数値（止まった日数と影響の計算に使います）</h2>
            <BusinessTable
              businesses={profile.businesses}
              assetLabel={(id) => profile.assets.find((a) => a.id === id)?.label ?? id}
              onChange={(id, f) => save(updateBusiness(profile, id, f))}
            />
          </div>

          <div className="panel">
            <h2>個人情報（構成要素ごと）</h2>
            <PersonalDataTable
              assets={profile.assets}
              personalData={profile.personalData}
              onChange={(assetId, data) => save(setPersonalData(profile, assetId, data))}
            />
          </div>
        </>
      )}

      <ProfileFile profile={profile} onReplace={(p) => save(p)} />
    </div>
  );
}
