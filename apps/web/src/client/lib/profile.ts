/**
 * 会社カルテの詳細登録（#/profile）の純粋な関数。
 * 担当者の回答をカルテに書く（engine の applyAnswer と同じ結果をブラウザ側で作る）、
 * 根拠の優先順位（外部確認 > ベンダー回答 > 担当者登録）の判定、半年経過の判定、業務・個人情報・属性の更新。
 * どれも元のカルテを変えず、新しいカルテを返す。判定そのものは必ず API（engine）に頼む。
 */
import type { AnswerInput, ControlChoice, ControlQuestion } from "../../shared/api.ts";
import type { CompanyProfile, EvidenceKind } from "./types.ts";

type Asset = CompanyProfile["assets"][number];
type Control = Asset["controls"][number];
type Business = CompanyProfile["businesses"][number];
type PersonalData = CompanyProfile["personalData"][number];
type ControlStatus = Control["status"];

/** 担当者登録として書く回答 */
export type StaffAnswer = {
  assetId: string;
  mitigation: string;
  status: ControlStatus;
  /** 選んだ選択肢の文言（noteJa に残す） */
  noteJa?: string;
  attrs?: Record<string, string | number | boolean>;
  answeredBy: string;
  answeredAt: string;
};

const clone = <T>(v: T): T => structuredClone(v);

function upsertControl(asset: Asset, control: Control): void {
  const i = asset.controls.findIndex((c) => c.mitigation === control.mitigation);
  if (i >= 0) asset.controls[i] = control;
  else asset.controls.push(control);
}

/**
 * 担当者の回答をカルテに書いた新しいカルテを返す（engine の applyAnswer と同じ規則）。
 * 「分からない」は根拠なし（none）に戻す。属性の根拠は担当者登録
 */
export function applyStaffAnswer(profile: CompanyProfile, a: StaffAnswer): CompanyProfile {
  const next = clone(profile);
  const asset = next.assets.find((x) => x.id === a.assetId);
  if (!asset) throw new Error(`資産 ${a.assetId} がカルテにない`);
  const evidence: EvidenceKind = a.status === "unknown" ? "none" : "registered";
  upsertControl(asset, {
    mitigation: a.mitigation,
    status: a.status,
    evidence,
    ...(a.noteJa ? { noteJa: a.noteJa } : {}),
    answeredBy: a.answeredBy,
    answeredAt: a.answeredAt,
  });
  for (const [k, v] of Object.entries(a.attrs ?? {})) {
    asset.attrs[k] = v;
    asset.attrEvidence[k] = evidence;
  }
  return next;
}

/** 質問表の選択肢 → 担当者の回答 */
export function answerFromChoice(
  assetId: string,
  question: ControlQuestion,
  choice: ControlChoice,
  answeredBy: string,
  answeredAt: string,
): StaffAnswer {
  return {
    assetId,
    mitigation: question.mitigation,
    status: choice.status,
    noteJa: choice.labelJa,
    ...(choice.attrs ? { attrs: choice.attrs } : {}),
    answeredBy,
    answeredAt,
  };
}

/** 質問が無い緩和策の 3 択（あり／なし／未確認） */
export const PLAIN_CHOICES: ControlChoice[] = [
  { id: "present", labelJa: "あり", status: "present" },
  { id: "absent", labelJa: "なし", status: "absent" },
  { id: "unknown", labelJa: "分からない", status: "unknown" },
];

/** 質問表に無い緩和策のための質問（3 択） */
export function plainQuestion(mitigation: string, labelJa: string): ControlQuestion {
  return { mitigation, textJa: `${labelJa}はありますか`, choices: PLAIN_CHOICES };
}

/**
 * 資産の役割に合わせた質問。同じ緩和策 ID でも役割で判定の意味が違う（サーバの M1047 はアクセスログの監査、
 * ホームページの M1047 は改ざん検知）ので、質問表の byRole[role] があれば textJa・hintJa・choices を置き換える。
 * サーバ側の questionFor(mitigation, role) と同じ当てはめ方（役割の文言に hintJa が無ければ共通の hintJa も出さない）
 */
export function questionForRole(
  questions: ControlQuestion[],
  mitigation: string,
  role: string,
  fallbackLabelJa: string,
): ControlQuestion {
  const q = questions.find((x) => x.mitigation === mitigation);
  if (!q) return plainQuestion(mitigation, fallbackLabelJa);
  const variant = q.byRole?.[role];
  if (!variant) return q;
  const { byRole: _byRole, hintJa: _hint, ...rest } = q;
  return {
    ...rest,
    textJa: variant.textJa,
    ...(variant.hintJa ? { hintJa: variant.hintJa } : {}),
    ...(variant.choices ? { choices: variant.choices } : {}),
  };
}

/**
 * 上書きの可否：外部確認は変更不可、ベンダー回答は確認してから、それ以外は自由。
 * 送信箱の回答（outbox）は、画面を開き直すたびに再適用されるので変更不可として扱う
 */
export type OverwritePolicy = "locked_external" | "locked_outbox" | "confirm_vendor" | "free";

export function overwritePolicy(
  control: Pick<Control, "evidence" | "status"> | undefined,
  outboxAnswer: AnswerInput | undefined,
): OverwritePolicy {
  if (outboxAnswer) return "locked_outbox";
  if (!control || control.status === "unknown") return "free";
  if (control.evidence === "external") return "locked_external";
  if (control.evidence === "vendor") return "confirm_vendor";
  return "free";
}

export const STALE_DAYS = 180;

/** 回答から 180 日より前なら再確認を促す（日時が読めなければ促さない） */
export function isStale(answeredAt: string | undefined, now: Date, days = STALE_DAYS): boolean {
  if (!answeredAt) return false;
  const t = Date.parse(answeredAt);
  if (Number.isNaN(t)) return false;
  return now.getTime() - t > days * 86_400_000;
}

/** 送信箱の回答を、画面に出す緩和策の状態に重ねる（判定と同じ見え方にする） */
export function effectiveControl(
  control: Control | undefined,
  outboxAnswer: AnswerInput | undefined,
  mitigation: string,
): Control {
  if (outboxAnswer) {
    return {
      mitigation,
      status: outboxAnswer.status,
      evidence: outboxAnswer.status === "unknown" ? "none" : outboxAnswer.evidence,
      ...(outboxAnswer.noteJa ? { noteJa: outboxAnswer.noteJa } : {}),
      answeredBy: outboxAnswer.answeredBy,
      ...(outboxAnswer.answeredAt ? { answeredAt: outboxAnswer.answeredAt } : {}),
    };
  }
  return control ?? { mitigation, status: "unknown", evidence: "none" };
}

/** 未確認の緩和策の数 */
export function pendingCount(profile: CompanyProfile): number {
  return profile.assets.reduce(
    (n, a) => n + a.controls.filter((c) => c.status === "unknown").length,
    0,
  );
}

/** 確認の進み具合：緩和策の総数と、根拠ごとの確認済みの数、未確認の数 */
export type Progress = {
  total: number;
  /** 未確認（status が unknown） */
  unknown: number;
  external: number;
  vendor: number;
  registered: number;
  /** 状態は確認済みだが根拠の種類が「なし」のもの（ふつうは 0） */
  other: number;
};

/** 画面の一覧と同じ見え方（送信箱のベンダー回答を重ねたもの）で、確認の進み具合を数える */
export function controlProgress(profile: CompanyProfile, outbox: AnswerInput[]): Progress {
  const out: Progress = { total: 0, unknown: 0, external: 0, vendor: 0, registered: 0, other: 0 };
  for (const a of profile.assets) {
    for (const c of a.controls) {
      const e = effectiveControl(
        c,
        outbox.find((x) => x.assetId === a.id && x.mitigation === c.mitigation),
        c.mitigation,
      );
      out.total += 1;
      if (e.status === "unknown") out.unknown += 1;
      else if (e.evidence === "external") out.external += 1;
      else if (e.evidence === "vendor") out.vendor += 1;
      else if (e.evidence === "registered") out.registered += 1;
      else out.other += 1;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 会社・資産・業務・個人情報の更新（すべて新しいカルテを返す）
// ---------------------------------------------------------------------------
export type CompanyFields = Pick<
  CompanyProfile,
  "companyName" | "employees" | "dailyRevenue" | "typicalTransferJpy" | "cyberInsurance" | "vendor"
>;

/** 省略可の項目は undefined なら消す（zod の exactOptionalPropertyTypes に合わせる） */
export function updateCompany(profile: CompanyProfile, f: Partial<CompanyFields>): CompanyProfile {
  const next = clone(profile);
  if (f.companyName !== undefined) next.companyName = f.companyName.trim() || next.companyName;
  for (const key of ["employees", "dailyRevenue", "typicalTransferJpy"] as const) {
    if (!(key in f)) continue;
    const v = f[key];
    if (v === undefined || Number.isNaN(v)) delete next[key];
    else next[key] = v;
  }
  if ("cyberInsurance" in f) {
    if (f.cyberInsurance === undefined) delete next.cyberInsurance;
    else next.cyberInsurance = f.cyberInsurance;
  }
  if ("vendor" in f) {
    if (f.vendor === undefined || !f.vendor.name.trim()) delete next.vendor;
    else {
      const email = f.vendor.email?.trim();
      next.vendor = { name: f.vendor.name.trim(), ...(email ? { email } : {}) };
    }
  }
  return next;
}

/** サイバー保険の 3 択（加入している／していない／分からない） */
export type InsuranceChoice = "yes" | "no" | "unknown";

/**
 * カルテの cyberInsurance → 3 択。「分からない」は cyberInsurance を持たない状態（未回答と同じ）。
 * 判定は enrolled が真のときだけ保険を前提にするので、「していない」と「分からない」で結論は変わらない
 */
export function insuranceChoice(ins: CompanyProfile["cyberInsurance"]): InsuranceChoice {
  if (!ins) return "unknown";
  return ins.enrolled ? "yes" : "no";
}

/** 3 択 → カルテの cyberInsurance。加入しているときだけ、すでにある通知期限を残す */
export function insuranceFromChoice(
  choice: InsuranceChoice,
  current: CompanyProfile["cyberInsurance"],
): CompanyProfile["cyberInsurance"] {
  if (choice === "unknown") return undefined;
  if (choice === "no") return { enrolled: false };
  return {
    enrolled: true,
    ...(current?.enrolled && current.notifyWithinDays
      ? { notifyWithinDays: current.notifyWithinDays }
      : {}),
  };
}

/** 製品名と版（自由入力。空なら消す。Claude には渡らない） */
export function setAssetProduct(
  profile: CompanyProfile,
  assetId: string,
  product: string | undefined,
  version: string | undefined,
): CompanyProfile {
  const next = clone(profile);
  const asset = next.assets.find((x) => x.id === assetId);
  if (!asset) throw new Error(`資産 ${assetId} がカルテにない`);
  const p = product?.trim();
  const v = version?.trim();
  if (p) asset.product = p;
  else delete asset.product;
  if (v) asset.version = v;
  else delete asset.version;
  return next;
}

export function updateBusiness(
  profile: CompanyProfile,
  businessId: string,
  f: Partial<
    Pick<Business, "manualDays" | "recoveryDays" | "recoveryDaysWithBackup" | "affectsJa">
  >,
): CompanyProfile {
  const next = clone(profile);
  const b = next.businesses.find((x) => x.id === businessId);
  if (!b) throw new Error(`業務 ${businessId} がカルテにない`);
  if (f.manualDays !== undefined && !Number.isNaN(f.manualDays)) b.manualDays = f.manualDays;
  if (f.recoveryDays !== undefined && !Number.isNaN(f.recoveryDays))
    b.recoveryDays = f.recoveryDays;
  if ("recoveryDaysWithBackup" in f) {
    const v = f.recoveryDaysWithBackup;
    if (v === undefined || Number.isNaN(v)) delete b.recoveryDaysWithBackup;
    else b.recoveryDaysWithBackup = v;
  }
  if ("affectsJa" in f) {
    const v = f.affectsJa?.trim();
    if (v) b.affectsJa = v;
    else delete b.affectsJa;
  }
  return next;
}

/** 資産ごとの個人情報：無ければ消す、あれば 1 件に置き換える（資産 1 つにつき 1 行で扱う） */
export function setPersonalData(
  profile: CompanyProfile,
  assetId: string,
  data: Omit<PersonalData, "assetId"> | undefined,
): CompanyProfile {
  const next = clone(profile);
  const i = next.personalData.findIndex((p) => p.assetId === assetId);
  if (!data) {
    if (i >= 0) next.personalData.splice(i, 1);
    return next;
  }
  const count = data.count;
  const row: PersonalData = {
    assetId,
    descriptionJa: data.descriptionJa.trim() || "個人情報",
    ...(count !== undefined && !Number.isNaN(count) ? { count } : {}),
    over1000: count !== undefined && !Number.isNaN(count) ? count > 1000 : data.over1000,
    sensitive: data.sensitive,
  };
  if (i >= 0) next.personalData[i] = row;
  else next.personalData.push(row);
  return next;
}

const STAFF_KEY = "uchidai.staffName.v1";
/** 担当者名（回答者として記録する）。カルテとは別にこのブラウザに保存する */
export const staffName = {
  load(): string {
    try {
      return localStorage.getItem(STAFF_KEY) ?? "";
    } catch {
      return "";
    }
  },
  save(name: string): void {
    try {
      localStorage.setItem(STAFF_KEY, name);
    } catch {
      // 保存できなくても画面は動く
    }
  },
};
