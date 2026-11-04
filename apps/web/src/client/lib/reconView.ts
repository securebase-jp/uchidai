/**
 * 外部確認の結果を画面の項目に組み立てる純粋な関数。判定も推定もここではしない（推定は recon の固定表）。
 * - groupFindings：確認項目をカテゴリ順に並べる（根拠と IPA 事例番号つき）
 * - warningsOf：警告だけを集める（warn の項目と注記）
 * - ctSourceLabel：参照した証明書ログの検索先の名前（実際に使った方）
 * - applyChanges：「カルテに反映する」で何が変わるか（属性の上書き、緩和策の追加、5 問の初期値）
 */
import type { AppliedView, Finding, InferredAnswerKey, ReconResult } from "./reconApi.ts";
import type { CompanyProfile } from "./types.ts";

/** 「参照：…」の行に出す、証明書ログの検索先。crt.sh が使えなかったときの予備は、使ったと分かるように書く */
export function ctSourceLabel(sources: ReconResult["sources"]): string {
  if (sources.ct === "fixture") return "記録";
  if (sources.ct === "unavailable") return "今回は取得できず";
  return sources.ctProvider === "certspotter"
    ? "Cert Spotter。crt.sh で得られなかったため"
    : "crt.sh";
}

export const CATEGORY_LABEL: Record<Finding["category"], string> = {
  remote_access: "社外からの入口（VPN・遠隔操作）と推定されるホスト名",
  mail_auth: "メールのなりすまし対策（SPF・DMARC）",
  mail_provider: "メールの提供元",
  cloud_services: "クラウドサービスの手がかり",
  web_hosting: "ホームページの置き場所",
  hostnames: "証明書の公開ログに載っているホスト名",
};
const CATEGORY_ORDER: Finding["category"][] = [
  "remote_access",
  "mail_auth",
  "mail_provider",
  "cloud_services",
  "web_hosting",
  "hostnames",
];
/** 「推定」の語を添えるカテゴリ（固定表の当てはめであり、断定ではない） */
const INFERRED_CATEGORIES = new Set<Finding["category"]>([
  "remote_access",
  "mail_provider",
  "cloud_services",
  "web_hosting",
]);

export const SEVERITY_LABEL: Record<Finding["severity"], string> = {
  ok: "問題なし",
  info: "参考",
  warn: "要確認",
};
export const SEVERITY_TONE: Record<Finding["severity"], "green" | "amber" | "red"> = {
  ok: "green",
  info: "amber",
  warn: "red",
};

export type FindingGroup = {
  category: Finding["category"];
  labelJa: string;
  inferred: boolean;
  findings: Finding[];
};

export function groupFindings(result: ReconResult): FindingGroup[] {
  const groups: FindingGroup[] = [];
  for (const category of CATEGORY_ORDER) {
    const findings = result.findings.filter((f) => f.category === category);
    if (findings.length === 0) continue;
    groups.push({
      category,
      labelJa: CATEGORY_LABEL[category],
      inferred: INFERRED_CATEGORIES.has(category),
      findings,
    });
  }
  return groups;
}

/** 警告：要確認の項目の見出しと、参照できなかった項目などの注記 */
export function warningsOf(result: ReconResult): string[] {
  return [
    ...result.findings.filter((f) => f.severity === "warn").map((f) => f.titleJa),
    ...result.notesJa,
  ];
}

export const ANSWER_KEY_LABEL: Record<InferredAnswerKey, string> = {
  "hosting.mail": "メールの置き場所",
  "hosting.web": "ホームページの置き場所",
  remoteAccess: "社外からのつなぎ方",
};
const HOSTING_LABEL: Record<string, string> = {
  onprem: "社内のサーバ",
  cloud: "クラウドサービス",
  provider: "レンタルサーバ・プロバイダ",
  unknown: "分からない",
};
const REMOTE_LABEL: Record<string, string> = {
  vpn: "VPN装置",
  rdp: "リモートデスクトップなどの遠隔操作ツール",
  vendor_remote: "保守業者の遠隔接続",
  cloud_only: "クラウドだけ",
  unknown: "分からない",
};

export type AttrChange = {
  assetId: string;
  assetLabel: string;
  key: string;
  before: string | undefined;
  after: string;
  /** 登録済みの値を上書きするか（新しく付くだけなら false） */
  overwrite: boolean;
};
export type ControlChange = {
  assetId: string;
  assetLabel: string;
  mitigation: string;
  status: string;
  noteJa: string | undefined;
};
export type AnswerChange = { key: InferredAnswerKey; labelJa: string; after: string };

export type ApplyChanges = {
  attrs: AttrChange[];
  controls: ControlChange[];
  answers: AnswerChange[];
  /** 役割が一致する資産が無く、反映されない役割 */
  domainChange: { before: string | undefined; after: string } | undefined;
};

const show = (v: unknown): string =>
  v === undefined ? "" : typeof v === "boolean" ? (v ? "あり" : "なし") : String(v);

/** 反映前後のカルテを比べ、画面に見せる差分を作る */
export function applyChanges(before: CompanyProfile, applied: AppliedView): ApplyChanges {
  const attrs: AttrChange[] = [];
  const controls: ControlChange[] = [];
  const after = applied.profile;
  for (const next of after.assets) {
    const prev = before.assets.find((a) => a.id === next.id);
    if (!prev) continue;
    for (const [key, value] of Object.entries(next.attrs)) {
      if (next.attrEvidence[key] !== "external") continue;
      const old = prev.attrs[key];
      if (old === value && prev.attrEvidence[key] === "external") continue;
      attrs.push({
        assetId: next.id,
        assetLabel: next.label,
        key,
        before: old === undefined ? undefined : show(old),
        after: show(value),
        overwrite: old !== undefined && old !== value,
      });
    }
    for (const c of next.controls) {
      if (c.evidence !== "external") continue;
      const same = prev.controls.find(
        (p) => p.mitigation === c.mitigation && p.evidence === "external" && p.status === c.status,
      );
      if (same) continue;
      controls.push({
        assetId: next.id,
        assetLabel: next.label,
        mitigation: c.mitigation,
        status: c.status,
        noteJa: c.noteJa,
      });
    }
  }
  const answers: AnswerChange[] = (applied.answers?.applied ?? []).map((key) => {
    const merged = applied.answers?.merged;
    const value =
      key === "hosting.mail"
        ? HOSTING_LABEL[merged?.hosting.mail ?? ""]
        : key === "hosting.web"
          ? HOSTING_LABEL[merged?.hosting.web ?? ""]
          : (merged?.remoteAccess ?? []).map((r) => REMOTE_LABEL[r] ?? r).join("、");
    return { key, labelJa: ANSWER_KEY_LABEL[key], after: value ?? "" };
  });
  const domainChange =
    before.domain === after.domain && before.domainVerified === after.domainVerified
      ? undefined
      : { before: before.domain, after: after.domain ?? "" };
  return { attrs, controls, answers, domainChange };
}

/** 5 問の画面向け：推定した値とその理由 */
export function hintLabel(key: InferredAnswerKey, value: string): string {
  if (key === "remoteAccess") return REMOTE_LABEL[value] ?? value;
  return HOSTING_LABEL[value] ?? value;
}
