/**
 * カルテの数値と名前の入力：会社（従業員数、売上、保険、送金額、保守ベンダー）、業務の日数、個人情報。
 * 文字入力は名前と短い文だけ。入力が確定（欄を離れる）したときにカルテを保存する
 */
import { type ReactNode, useEffect, useState } from "react";
import {
  EMPLOYEE_PRESETS,
  formatJpy,
  INSURANCE_DAYS_PRESETS,
  REVENUE_PRESETS,
  TRANSFER_PRESETS,
  WORKING_DAYS_PER_YEAR,
} from "../lib/choices.ts";
import {
  type CompanyFields,
  type InsuranceChoice,
  insuranceChoice,
  insuranceFromChoice,
} from "../lib/profile.ts";
import type { CompanyProfile } from "../lib/types.ts";
import { ChoiceNumber } from "./ChoiceNumber.tsx";
import { type ChoiceOption, ChoiceSet } from "./ChoiceSet.tsx";
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

/** 項目名（任意で情報ボタン）と入力部品を縦に並べる。ボタン列の項目は label ではなく div で包む */
function Field({
  label,
  htmlFor,
  info,
  children,
}: {
  label: string;
  htmlFor?: string;
  info?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="f">
      <span className="k">
        {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : label}
        {info}
      </span>
      {children}
    </div>
  );
}

const INSURANCE_OPTIONS: ChoiceOption<InsuranceChoice>[] = [
  { value: "yes", labelJa: "加入している" },
  { value: "no", labelJa: "していない" },
  { value: "unknown", labelJa: "分からない" },
];

export function CompanyForm({
  profile,
  onChange,
}: {
  profile: CompanyProfile;
  onChange(f: Partial<CompanyFields>): void;
}) {
  const ins = profile.cyberInsurance;
  const insurance = insuranceChoice(ins);
  return (
    <>
      <div className="fields">
        <label className="f" htmlFor="pf-company">
          <span className="k">会社名</span>
          <BlurInput
            id="pf-company"
            value={profile.companyName}
            onCommit={(v) => onChange({ companyName: v })}
          />
        </label>
        <label className="f" htmlFor="pf-vendor">
          <span className="k">
            保守ベンダー（任意）
            <InfoButton title="保守ベンダーについて">
              <p>
                カルテで「分からない」とした項目の確認依頼の宛先になります。名前だけでも登録できます。
              </p>
            </InfoButton>
          </span>
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

      <div className="choice-fields">
        <Field
          label="従業員数"
          htmlFor="pf-employees"
          info={
            <InfoButton title="従業員数の使いみち">
              <p>
                対策の費用の目安に使います。ボタンは近い人数の近道で、欄には正確な人数を直接入れられます。
              </p>
            </InfoButton>
          }
        >
          <ChoiceNumber
            id="pf-employees"
            ariaLabel="従業員数（人）"
            unit="人"
            min={1}
            presets={EMPLOYEE_PRESETS}
            value={profile.employees}
            onCommit={(v) => onChange({ employees: v })}
          />
        </Field>

        <Field
          label="1 日あたりの売上（任意）"
          htmlFor="pf-revenue"
          info={
            <InfoButton title="1 日あたりの売上について">
              <p>
                業務が止まった日数 × この額で、売上への影響の目安を出します。実際の 1
                日あたりの売上が分かるときは、欄に直接入れてください。
              </p>
              <p>
                ボタンは年商です。押すと、年商を年 {WORKING_DAYS_PER_YEAR} 営業日で割った 1
                日分を万円単位に四捨五入して欄に入れます（例：25 億円 → 1,000
                万円）。実際の営業日数や、
                土日も動く業態とはずれることがあるので、あくまで目安です。
              </p>
            </InfoButton>
          }
        >
          <ChoiceNumber
            id="pf-revenue"
            ariaLabel="1 日あたりの売上（円）"
            presetsCaption="年商"
            unit="円"
            step={10000}
            presets={REVENUE_PRESETS}
            value={profile.dailyRevenue}
            readout={formatJpy}
            onCommit={(v) => onChange({ dailyRevenue: v })}
          />
        </Field>

        <Field
          label="送金額の目安（任意）"
          htmlFor="pf-transfer"
          info={
            <InfoButton title="送金額の目安について">
              <p>
                なりすまし送金（偽の請求書メールなど）で想定する 1
                回の送金額です。資金が流出する経路の影響額の計算に使います。
              </p>
            </InfoButton>
          }
        >
          <ChoiceNumber
            id="pf-transfer"
            ariaLabel="送金額の目安（円）"
            unit="円"
            step={100000}
            presets={TRANSFER_PRESETS}
            value={profile.typicalTransferJpy}
            readout={formatJpy}
            onCommit={(v) => onChange({ typicalTransferJpy: v })}
          />
        </Field>

        <Field
          label="サイバー保険"
          info={
            <InfoButton title="サイバー保険について">
              <p>
                加入しているときは、事故を保険会社に通知する期限を経過表に載せます。「していない」と「分からない」は、どちらも保険を前提にしません。
              </p>
              <p>
                「分からない」は未回答と同じ扱いで、カルテには何も残りません。保険証券や総務の担当者に確かめたら選び直してください。
              </p>
            </InfoButton>
          }
        >
          <ChoiceSet
            ariaLabel="サイバー保険"
            options={INSURANCE_OPTIONS}
            value={insurance}
            onChange={(c) => onChange({ cyberInsurance: insuranceFromChoice(c, ins) })}
          />
          {insurance === "yes" && (
            <div className="sub-field">
              <span className="h">
                事故を保険会社に通知する期限
                <InfoButton title="通知期限について">
                  <p>
                    保険証券に書かれている、事故を知ってから保険会社へ連絡するまでの日数です。分からないときは空のままにしてください（経過表には「期限は保険証券で確認」と出ます）。
                  </p>
                </InfoButton>
              </span>
              <ChoiceNumber
                ariaLabel="事故の通知期限（日）"
                unit="日"
                min={1}
                presets={INSURANCE_DAYS_PRESETS}
                value={ins?.notifyWithinDays}
                onCommit={(d) =>
                  onChange({
                    cyberInsurance: { enrolled: true, ...(d ? { notifyWithinDays: d } : {}) },
                  })
                }
              />
            </div>
          )}
        </Field>
      </div>
    </>
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
