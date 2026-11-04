/**
 * カルテの数値と名前の入力：会社（従業員数、売上、保険、送金額、保守ベンダー）、業務の日数、個人情報。
 * 文字入力は名前と短い文だけ。入力が確定（欄を離れる）したときにカルテを保存する
 */
import { ChevronDown, ChevronRight } from "lucide-react";
import { type ReactNode, useEffect, useId, useState } from "react";
import { getHint, personalHints, withHint } from "../lib/choice-hints.ts";
import {
  AFFECTS_EXAMPLES,
  COUNT_BUCKETS,
  type CountBucket,
  DAY_PRESETS,
  EMPLOYEE_PRESETS,
  formatJpy,
  INSURANCE_DAYS_PRESETS,
  numberFromText,
  PERSONAL_DATA_EXAMPLES,
  REVENUE_PRESETS,
  shownBucket,
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
  /** 候補（<datalist> の id）。候補に無い言葉も自由に入れられる */
  list?: string;
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
      {...(props.list ? { list: props.list } : {})}
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
export function Field({
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
                を設定しているときだけ、「ベンダーに確認する」を押した時点でこのアドレスへ送られます。ベンダーにはメールに返信して番号で答えてもらい、届いた返信を担当者が送信箱から入力すると、判定に反映されます。
              </p>
              <p>
                アドレスはこのブラウザのカルテに保存され、依頼を作ったときだけ宛先として送信箱に記録されます。Claude
                には送りません。入れなくても、送信箱の文面をコピーして、ふだん使っている連絡手段で送れば使えます。
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

/** 業務の日数の棒の長さをそろえる基準（いちばん長い日数。短くても 7 日分の幅は確保する） */
function maxDays(businesses: Business[]): number {
  return Math.max(
    7,
    ...businesses.flatMap((b) => [b.manualDays, b.recoveryDays, b.recoveryDaysWithBackup ?? 0]),
  );
}

function DayBar({
  label,
  days,
  max,
  tone,
}: {
  label: string;
  days: number;
  max: number;
  tone: "steel" | "green" | "amber";
}) {
  return (
    <span className="biz-bar">
      <span className="lbl">{label}</span>
      <span className="track" aria-hidden="true">
        <span className={`fill ${tone}`} style={{ width: `${Math.max(2, (days / max) * 100)}%` }} />
      </span>
      <span className="val">{days} 日</span>
    </span>
  );
}

function BusinessRow({
  business: b,
  assetLabel,
  max,
  affectsList,
  onChange,
}: {
  business: Business;
  assetLabel: string;
  max: number;
  affectsList: string;
  onChange(f: Partial<Pick<Business, BusinessField>>): void;
}) {
  const [open, setOpen] = useState(false);
  const uid = useId();
  const stopsPartner = b.recoveryDays > b.manualDays;
  return (
    <li className="biz">
      <button
        type="button"
        className="biz-head"
        aria-expanded={open}
        aria-controls={`${uid}-body`}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="biz-title">
          {open ? (
            <ChevronDown size={16} aria-hidden="true" />
          ) : (
            <ChevronRight size={16} aria-hidden="true" />
          )}
          <b>{b.name}</b>
          <span className="muted small">{assetLabel || "―"}</span>
        </span>
        <span className="biz-bars">
          <DayBar label="手作業" days={b.manualDays} max={max} tone="steel" />
          <DayBar
            label="復旧"
            days={b.recoveryDays}
            max={max}
            tone={stopsPartner ? "amber" : "green"}
          />
          {b.recoveryDaysWithBackup !== undefined && (
            <DayBar
              label="バックアップあり"
              days={b.recoveryDaysWithBackup}
              max={max}
              tone="green"
            />
          )}
        </span>
        {b.affectsJa && <span className="biz-affects">影響先：{b.affectsJa}</span>}
      </button>
      {open && (
        <div className="biz-body" id={`${uid}-body`}>
          <Field label="手作業で回せる日数" htmlFor={`${uid}-manual`}>
            <ChoiceNumber
              compact
              id={`${uid}-manual`}
              ariaLabel={`${b.name}：手作業で回せる日数`}
              unit="日"
              allowEmpty={false}
              presets={DAY_PRESETS}
              value={b.manualDays}
              onCommit={(v) => v !== undefined && onChange({ manualDays: v })}
            />
          </Field>
          <Field label="復旧にかかる日数" htmlFor={`${uid}-recovery`}>
            <ChoiceNumber
              compact
              id={`${uid}-recovery`}
              ariaLabel={`${b.name}：復旧にかかる日数`}
              unit="日"
              allowEmpty={false}
              presets={DAY_PRESETS}
              value={b.recoveryDays}
              onCommit={(v) => v !== undefined && onChange({ recoveryDays: v })}
            />
          </Field>
          <Field
            label="切り離したバックアップがあるときの復旧日数（任意）"
            htmlFor={`${uid}-backup`}
          >
            <ChoiceNumber
              compact
              id={`${uid}-backup`}
              ariaLabel={`${b.name}：切り離したバックアップがあるときの復旧日数`}
              unit="日"
              presets={DAY_PRESETS}
              value={b.recoveryDaysWithBackup}
              onCommit={(v) => onChange({ recoveryDaysWithBackup: v })}
            />
          </Field>
          <label className="f" htmlFor={`${uid}-affects`}>
            <span className="k">影響先（任意）</span>
            <BlurInput
              id={`${uid}-affects`}
              list={affectsList}
              value={b.affectsJa ?? ""}
              placeholder="例：取引先の納期"
              onCommit={(v) => onChange({ affectsJa: v })}
            />
          </label>
        </div>
      )}
    </li>
  );
}

type BusinessField = "manualDays" | "recoveryDays" | "recoveryDaysWithBackup" | "affectsJa";

export function BusinessTable({
  businesses,
  assetLabel,
  affectsExamples = AFFECTS_EXAMPLES,
  onChange,
}: {
  businesses: Business[];
  assetLabel(id: string): string;
  /** 影響先の候補（業種の構成パターンの例）。無ければ固定の数例 */
  affectsExamples?: string[];
  onChange(id: string, f: Partial<Pick<Business, BusinessField>>): void;
}) {
  const listId = useId();
  if (businesses.length === 0) return <p className="muted">業務が登録されていません。</p>;
  const max = maxDays(businesses);
  return (
    <>
      <ul className="biz-list">
        {businesses.map((b) => (
          <BusinessRow
            key={b.id}
            business={b}
            assetLabel={b.assetIds.map(assetLabel).join("、")}
            max={max}
            affectsList={listId}
            onChange={(f) => onChange(b.id, f)}
          />
        ))}
      </ul>
      <datalist id={listId}>
        {affectsExamples.map((x) => (
          <option key={x} value={x} />
        ))}
      </datalist>
    </>
  );
}

const PRESENCE_OPTIONS: ChoiceOption<boolean>[] = [
  { value: false, labelJa: "なし" },
  { value: true, labelJa: "あり" },
];
const BUCKET_OPTIONS: ChoiceOption<CountBucket["id"]>[] = COUNT_BUCKETS.map((b) => ({
  value: b.id,
  labelJa: b.labelJa,
}));
type SensitiveChoice = "yes" | "no" | "unknown";
const SENSITIVE_OPTIONS: ChoiceOption<SensitiveChoice>[] = [
  { value: "yes", labelJa: "含む" },
  { value: "no", labelJa: "含まない" },
  { value: "unknown", labelJa: "分からない" },
];

export function PersonalDataTable({
  profileId,
  assets,
  personalData,
  onChange,
}: {
  /** 件数の区分などをこのブラウザに覚えるときの鍵（カルテの id） */
  profileId: string;
  assets: CompanyProfile["assets"];
  personalData: PersonalData[];
  onChange(assetId: string, data: Omit<PersonalData, "assetId"> | undefined): void;
}) {
  // 人（社長、経理担当）には個人情報を置かない。システム・機器・アカウントだけ
  const rows = assets.filter((a) => a.kind !== "person");
  const listId = useId();
  const [hints, setHints] = useState(() => personalHints.load());
  const hint = (assetId: string, patch: Parameters<typeof withHint>[3]) =>
    setHints((cur) => {
      const next = withHint(cur, profileId, assetId, patch);
      personalHints.save(next);
      return next;
    });
  return (
    <>
      <ul className="pd-list">
        {rows.map((a) => {
          const pd = personalData.find((p) => p.assetId === a.id);
          const h = getHint(hints, profileId, a.id);
          const put = (patch: Partial<Omit<PersonalData, "assetId">>) =>
            onChange(a.id, {
              descriptionJa: pd?.descriptionJa ?? "",
              over1000: pd?.over1000 ?? false,
              sensitive: pd?.sensitive ?? false,
              ...(pd?.count !== undefined ? { count: pd.count } : {}),
              ...patch,
            });
          const bucket = shownBucket(pd?.count, pd?.over1000 ?? false, h.bucket);
          const sensitive: SensitiveChoice = h.sensitiveUnknown
            ? "unknown"
            : pd?.sensitive
              ? "yes"
              : "no";
          return (
            <li key={a.id} className="pd">
              <div className="pd-head">
                <b>{a.label}</b>
                <ChoiceSet
                  compact
                  ariaLabel={`${a.label}：個人情報の有無`}
                  options={PRESENCE_OPTIONS}
                  value={pd !== undefined}
                  onChange={(on) => {
                    if (on) {
                      // 要配慮かどうかは、選ぶまで「分からない」（sensitive は既定の「含まない」のまま）
                      hint(a.id, { sensitiveUnknown: true });
                      put({});
                    } else {
                      hint(a.id, undefined);
                      onChange(a.id, undefined);
                    }
                  }}
                />
              </div>
              {pd && (
                <div className="pd-body">
                  <label className="f" htmlFor={`${listId}-${a.id}-desc`}>
                    <span className="k">内容（短い文）</span>
                    <BlurInput
                      id={`${listId}-${a.id}-desc`}
                      list={listId}
                      value={pd.descriptionJa}
                      selectOnFocus
                      placeholder="例：取引先担当者の連絡先"
                      onCommit={(v) => put({ descriptionJa: v })}
                    />
                  </label>
                  <Field
                    label="件数"
                    info={
                      <InfoButton title="件数の入れ方">
                        <p>
                          おおよその件数のボタンを選ぶと、1,000
                          件を超えるかどうか（報告義務の判定に使います）が決まります。正確な件数が分かるときは欄に入れてください。入れると、ボタンは件数から自動で決まります。
                        </p>
                        <p>
                          カルテには、1,000
                          件を超えるかと、入れた正確な件数だけが残ります。どのボタンを選んだかは、このブラウザにだけ覚えています。
                        </p>
                      </InfoButton>
                    }
                  >
                    <ChoiceSet
                      compact
                      ariaLabel={`${a.label}：個人情報のおおよその件数`}
                      options={BUCKET_OPTIONS}
                      value={bucket}
                      disabled={pd.count !== undefined}
                      onChange={(id) => {
                        const b = COUNT_BUCKETS.find((x) => x.id === id);
                        if (!b) return;
                        hint(a.id, { bucket: id });
                        put({ over1000: b.over1000 });
                      }}
                    />
                    <span className="cn-field">
                      <BlurInput
                        className="in num"
                        type="number"
                        min={0}
                        step={1}
                        value={str(pd.count)}
                        placeholder="正確な件数（任意）"
                        ariaLabel={`${a.label}：個人情報の正確な件数`}
                        onCommit={(v) => {
                          const r = numberFromText(v, { min: 0 });
                          const c = r.kind === "commit" ? r.value : pd.count;
                          hint(a.id, { bucket: undefined });
                          onChange(a.id, {
                            descriptionJa: pd.descriptionJa,
                            over1000: pd.over1000,
                            sensitive: pd.sensitive,
                            ...(c !== undefined ? { count: c } : {}),
                          });
                        }}
                      />
                      <span className="cn-unit">件</span>
                      {pd.count !== undefined && (
                        <span className="cn-readout">
                          {pd.over1000 ? "1,000 件超" : "1,000 件以下"}（件数から自動）
                        </span>
                      )}
                    </span>
                  </Field>
                  <Field
                    label="要配慮個人情報（病歴など）"
                    info={
                      <InfoButton title="要配慮個人情報について">
                        <p>
                          病歴、健診結果、犯罪歴などを含むかどうかです。含む場合は、件数にかかわらず個人情報保護委員会への報告が必要になります。
                        </p>
                        <p>
                          「分からない」は、分かるまで判定に「含まない」として扱います（カルテの値は既定のままで、答えたことにはしません）。分かったら選び直してください。
                        </p>
                      </InfoButton>
                    }
                  >
                    <ChoiceSet
                      compact
                      ariaLabel={`${a.label}：要配慮個人情報`}
                      options={SENSITIVE_OPTIONS}
                      value={sensitive}
                      onChange={(c) => {
                        hint(a.id, { sensitiveUnknown: c === "unknown" ? true : undefined });
                        put({ sensitive: c === "yes" });
                      }}
                    />
                    {sensitive === "unknown" && (
                      <span className="pd-note">分かるまでは「含まない」として判定します</span>
                    )}
                  </Field>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <datalist id={listId}>
        {PERSONAL_DATA_EXAMPLES.map((x) => (
          <option key={x} value={x} />
        ))}
      </datalist>
    </>
  );
}
