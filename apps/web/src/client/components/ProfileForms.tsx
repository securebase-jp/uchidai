/**
 * カルテの数値と名前の入力：会社（従業員数、売上、保険、送金額、保守ベンダー）、業務の日数、個人情報。
 * 文字入力は名前と短い文だけ。入力が確定（欄を離れる）したときにカルテを保存する
 */
import { useEffect, useState } from "react";
import type { CompanyFields } from "../lib/profile.ts";
import type { CompanyProfile } from "../lib/types.ts";
import { InfoButton } from "./InfoButton.tsx";

type Business = CompanyProfile["businesses"][number];
type PersonalData = CompanyProfile["personalData"][number];

const num = (v: string): number | undefined => (v.trim() === "" ? undefined : Number(v));
const str = (v: number | undefined): string => (v === undefined ? "" : String(v));

/** 欄を離れたときだけ親に知らせる入力欄（打つたびに判定が走らないように） */
function BlurInput(props: {
  value: string;
  onCommit(v: string): void;
  type?: "text" | "number";
  className?: string;
  placeholder?: string;
  min?: number;
  step?: number;
  ariaLabel?: string;
  id?: string;
  selectOnFocus?: boolean;
}) {
  const [v, setV] = useState(props.value);
  useEffect(() => setV(props.value), [props.value]);
  return (
    <input
      className={props.className ?? "in"}
      type={props.type ?? "text"}
      value={v}
      {...(props.id ? { id: props.id } : {})}
      {...(props.placeholder ? { placeholder: props.placeholder } : {})}
      {...(props.min !== undefined ? { min: props.min } : {})}
      {...(props.step !== undefined ? { step: props.step } : {})}
      {...(props.ariaLabel ? { "aria-label": props.ariaLabel } : {})}
      inputMode={props.type === "number" ? "numeric" : undefined}
      // 既定の文（「個人情報」など）が入っている欄は、焦点が当たったら全選択して打ち直せるようにする
      onFocus={(e) => props.selectOnFocus && e.target.select()}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        if (v !== props.value) props.onCommit(v);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

export function CompanyForm({
  profile,
  onChange,
}: {
  profile: CompanyProfile;
  onChange(f: Partial<CompanyFields>): void;
}) {
  const ins = profile.cyberInsurance;
  return (
    <div className="fields">
      <label className="f" htmlFor="pf-company">
        <span className="k">会社名</span>
        <BlurInput
          id="pf-company"
          value={profile.companyName}
          onCommit={(v) => onChange({ companyName: v })}
        />
      </label>
      <label className="f" htmlFor="pf-employees">
        <span className="k">従業員数（人）</span>
        <BlurInput
          id="pf-employees"
          className="in num"
          type="number"
          min={1}
          step={1}
          value={str(profile.employees)}
          onCommit={(v) => onChange({ employees: num(v) })}
        />
        <span className="h">対策の費用の目安に使います</span>
      </label>
      <label className="f" htmlFor="pf-revenue">
        <span className="k">1 日あたりの売上（円、任意）</span>
        <BlurInput
          id="pf-revenue"
          className="in num"
          type="number"
          min={0}
          step={10000}
          value={str(profile.dailyRevenue)}
          onCommit={(v) => onChange({ dailyRevenue: num(v) })}
        />
        <span className="h">業務が止まった日数 × 売上で影響額を出します</span>
      </label>
      <label className="f" htmlFor="pf-transfer">
        <span className="k">送金額の目安（円、任意）</span>
        <BlurInput
          id="pf-transfer"
          className="in num"
          type="number"
          min={0}
          step={100000}
          value={str(profile.typicalTransferJpy)}
          onCommit={(v) => onChange({ typicalTransferJpy: num(v) })}
        />
        <span className="h">なりすまし送金で想定する 1 回の送金額</span>
      </label>
      <div className="f">
        <span className="k">サイバー保険</span>
        <label className="chk">
          <input
            type="checkbox"
            checked={ins?.enrolled === true}
            onChange={(e) =>
              onChange({
                cyberInsurance: e.target.checked
                  ? {
                      enrolled: true,
                      ...(ins?.notifyWithinDays ? { notifyWithinDays: ins.notifyWithinDays } : {}),
                    }
                  : undefined,
              })
            }
          />
          加入している
        </label>
        {ins?.enrolled && (
          <label className="f" htmlFor="pf-insurance-days">
            <span className="h">事故を保険会社に通知する期限（日）</span>
            <BlurInput
              id="pf-insurance-days"
              className="in num"
              type="number"
              min={1}
              step={1}
              value={str(ins.notifyWithinDays)}
              ariaLabel="事故の通知期限（日）"
              onCommit={(v) => {
                const d = num(v);
                onChange({
                  cyberInsurance: {
                    enrolled: true,
                    ...(d && d > 0 ? { notifyWithinDays: d } : {}),
                  },
                });
              }}
            />
          </label>
        )}
      </div>
      <label className="f" htmlFor="pf-vendor">
        <span className="k">保守ベンダー（任意）</span>
        <BlurInput
          id="pf-vendor"
          value={profile.vendor?.name ?? ""}
          placeholder="会社名"
          onCommit={(v) =>
            onChange({
              vendor: {
                name: v,
                ...(profile.vendor?.email ? { email: profile.vendor.email } : {}),
              },
            })
          }
        />
        <span className="h">確認依頼の宛先になります</span>
      </label>
      <label className="f" htmlFor="pf-vendor-email">
        <span className="k">
          保守ベンダーのメール（任意）
          <InfoButton title="なぜメールアドレスを入れるのか">
            <p>
              カルテで「分からない」とした項目は、「ベンダーに確認する」で保守ベンダーへの確認依頼になります。ここに入れたメールアドレスは、その依頼の宛先として使います。
            </p>
            <p>
              既定では自動で送られません。「ベンダーに確認する」を押すと担当者画面の送信箱に文面ができ、内容を確かめてから「メールソフトで開く」で送ります。サーバに
              SMTP
              を設定しているときだけ、「ベンダーに確認する」を押した時点でこのアドレスへ送られます。ベンダーの回答は、メールのリンクから開く回答ページで受け取り、判定にその場で反映されます。
            </p>
            <p>
              アドレスはこのブラウザのカルテに保存され、依頼を作ったときだけ宛先として送信箱に記録されます。Claude
              には送りません。入れなくても、回答リンクを自分で別の方法で渡せば使えます。
            </p>
          </InfoButton>
        </span>
        <BlurInput
          id="pf-vendor-email"
          value={profile.vendor?.email ?? ""}
          placeholder="name@example.com"
          onCommit={(v) => onChange({ vendor: { name: profile.vendor?.name ?? "", email: v } })}
        />
      </label>
    </div>
  );
}

export function BusinessTable({
  businesses,
  assetLabel,
  onChange,
}: {
  businesses: Business[];
  assetLabel(id: string): string;
  onChange(
    id: string,
    f: Partial<
      Pick<Business, "manualDays" | "recoveryDays" | "recoveryDaysWithBackup" | "affectsJa">
    >,
  ): void;
}) {
  if (businesses.length === 0) return <p className="muted">業務が登録されていません。</p>;
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="profile-table">
        <thead>
          <tr>
            <th>業務</th>
            <th>依存する構成要素</th>
            <th>手作業で回せる日数</th>
            <th>復旧にかかる日数</th>
            <th>切り離したバックアップがあるときの復旧日数</th>
            <th>影響先（短い文）</th>
          </tr>
        </thead>
        <tbody>
          {businesses.map((b) => (
            <tr key={b.id}>
              <td>
                <b>{b.name}</b>
              </td>
              <td className="muted">{b.assetIds.map(assetLabel).join("、") || "―"}</td>
              <td>
                <BlurInput
                  className="in num"
                  type="number"
                  min={0}
                  step={1}
                  value={str(b.manualDays)}
                  ariaLabel={`${b.name}：手作業で回せる日数`}
                  onCommit={(v) => onChange(b.id, { manualDays: num(v) ?? b.manualDays })}
                />
              </td>
              <td>
                <BlurInput
                  className="in num"
                  type="number"
                  min={0}
                  step={1}
                  value={str(b.recoveryDays)}
                  ariaLabel={`${b.name}：復旧にかかる日数`}
                  onCommit={(v) => onChange(b.id, { recoveryDays: num(v) ?? b.recoveryDays })}
                />
              </td>
              <td>
                <BlurInput
                  className="in num"
                  type="number"
                  min={0}
                  step={1}
                  value={str(b.recoveryDaysWithBackup)}
                  placeholder="任意"
                  ariaLabel={`${b.name}：切り離したバックアップがあるときの復旧日数`}
                  onCommit={(v) => onChange(b.id, { recoveryDaysWithBackup: num(v) })}
                />
              </td>
              <td>
                <BlurInput
                  className="in txt"
                  value={b.affectsJa ?? ""}
                  placeholder="例：取引先の納期"
                  ariaLabel={`${b.name}：影響先`}
                  onCommit={(v) => onChange(b.id, { affectsJa: v })}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PersonalDataTable({
  assets,
  personalData,
  onChange,
}: {
  assets: CompanyProfile["assets"];
  personalData: PersonalData[];
  onChange(assetId: string, data: Omit<PersonalData, "assetId"> | undefined): void;
}) {
  // 人（社長、経理担当）には個人情報を置かない。システム・機器・アカウントだけ
  const rows = assets.filter((a) => a.kind !== "person");
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="profile-table">
        <thead>
          <tr>
            <th>構成要素</th>
            <th>個人情報の有無</th>
            <th>説明（短い文）</th>
            <th>件数（任意）</th>
            <th>1,000 件超</th>
            <th>要配慮（病歴など）</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => {
            const pd = personalData.find((p) => p.assetId === a.id);
            const put = (patch: Partial<Omit<PersonalData, "assetId">>) =>
              onChange(a.id, {
                descriptionJa: pd?.descriptionJa ?? "",
                over1000: pd?.over1000 ?? false,
                sensitive: pd?.sensitive ?? false,
                ...(pd?.count !== undefined ? { count: pd.count } : {}),
                ...patch,
              });
            return (
              <tr key={a.id}>
                <td>
                  <b>{a.label}</b>
                </td>
                <td>
                  <label className="chk">
                    <input
                      type="checkbox"
                      checked={pd !== undefined}
                      aria-label={`${a.label}：個人情報の有無`}
                      onChange={(e) =>
                        e.target.checked
                          ? put({ descriptionJa: pd?.descriptionJa ?? "" })
                          : onChange(a.id, undefined)
                      }
                    />
                    あり
                  </label>
                </td>
                <td>
                  {pd && (
                    <BlurInput
                      className="in txt"
                      value={pd.descriptionJa}
                      selectOnFocus
                      placeholder="例：取引先担当者の連絡先"
                      ariaLabel={`${a.label}：個人情報の説明`}
                      onCommit={(v) => put({ descriptionJa: v })}
                    />
                  )}
                </td>
                <td>
                  {pd && (
                    <BlurInput
                      className="in num"
                      type="number"
                      min={0}
                      step={1}
                      value={str(pd.count)}
                      placeholder="任意"
                      ariaLabel={`${a.label}：個人情報の件数`}
                      onCommit={(v) => {
                        const c = num(v);
                        onChange(a.id, {
                          descriptionJa: pd.descriptionJa,
                          over1000: pd.over1000,
                          sensitive: pd.sensitive,
                          ...(c !== undefined ? { count: c } : {}),
                        });
                      }}
                    />
                  )}
                </td>
                <td>
                  {pd && (
                    <label className="chk">
                      <input
                        type="checkbox"
                        checked={pd.over1000}
                        disabled={pd.count !== undefined}
                        aria-label={`${a.label}：1,000 件超`}
                        onChange={(e) => put({ over1000: e.target.checked })}
                      />
                      {pd.count !== undefined ? "（件数から自動）" : "超える"}
                    </label>
                  )}
                </td>
                <td>
                  {pd && (
                    <label className="chk">
                      <input
                        type="checkbox"
                        checked={pd.sensitive}
                        aria-label={`${a.label}：要配慮個人情報`}
                        onChange={(e) => put({ sensitive: e.target.checked })}
                      />
                      含む
                    </label>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
