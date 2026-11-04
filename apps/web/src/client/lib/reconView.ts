/**
 * 外部確認の結果を画面の項目に組み立てる純粋な関数。判定も推定もここではしない（推定は recon の固定表）。
 * - checkRows：確認項目をカテゴリ順に並べ、1 行ずつのチェック（短い項目名と結果）にする。説明と根拠は行を開くと出す
 * - countStates：チェックの状態ごとの件数
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

/** 参照した証明書ログの検索先の出典 id（knowledge/sources.yaml）。画面で出典番号を付けるのに使う */
export function ctSourceIds(sources: ReconResult["sources"]): string[] {
  if (sources.ct !== "live") return [];
  return sources.ctProvider === "certspotter" ? ["certspotter", "crtsh"] : ["crtsh"];
}

/**
 * チェック一覧の状態。問題なし・要確認・問題あり・参考の 4 つ。
 * 重大度（ok/info/warn）をそのまま写し、SPF・DMARC が「無い」ときだけ「問題あり」にする（表示の区別。判定は変えない）
 */
export type CheckState = "ok" | "warn" | "bad" | "info";
export const CHECK_STATE_LABEL: Record<CheckState, string> = {
  ok: "問題なし",
  warn: "要確認",
  bad: "問題あり",
  info: "参考",
};

/** チェック一覧の 1 行（項目名と結果は短く。説明と根拠は finding に残し、行を開くと出す） */
export type CheckRow = {
  id: string;
  /** 項目名（短く） */
  nameJa: string;
  /** 結果（短く） */
  resultJa: string;
  state: CheckState;
  /** 固定表の当てはめによる推定か（「推定」の札を付ける） */
  inferred: boolean;
  finding: Finding;
  /** 開いたときに出す、同じ項目の根拠として見せるホスト名（VPN・遠隔操作の候補） */
  candidates: ReconResult["remoteAccessCandidates"];
};

const ROW_NAME: Record<string, string> = {
  "remote_access.vpn": "VPN 用ホスト",
  "remote_access.rdp": "遠隔操作用ホスト",
  "mail_auth.spf": "SPF",
  "mail_auth.dmarc": "DMARC",
  "mail_provider.mx": "メールの提供元",
  "cloud_services.spf": "クラウドの手がかり",
  "web_hosting.hint": "ホームページの置き場所",
  "hostnames.ct": "証明書の公開ログ",
  "certificates.expired": "期限切れの証明書",
};

/** ホスト名を 2 件まで並べ、残りは「ほか N 件」にする */
function hostList(names: string[]): string {
  if (names.length <= 2) return names.join("、");
  return `${names.slice(0, 2).join("、")} ほか ${names.length - 2} 件`;
}

function resultOf(f: Finding, r: ReconResult): string {
  switch (f.id) {
    case "remote_access.vpn":
    case "remote_access.rdp": {
      const kind = f.id === "remote_access.vpn" ? "vpn" : "rdp";
      const all = r.remoteAccessCandidates.filter((c) => c.kind === kind);
      const current = all.filter((c) => c.current).map((c) => c.hostname);
      if (current.length > 0) return hostList(current);
      return all.length > 0 ? `過去の痕跡 ${all.length} 件` : "見つからず";
    }
    case "mail_auth.spf": {
      if (!r.mail.spf.present) return "なし";
      if (r.mail.spf.evidence.length > 1) return `${r.mail.spf.evidence.length} 件が重複`;
      return `あり（${r.mail.spf.allMechanism ?? "all なし"}）`;
    }
    case "mail_auth.dmarc": {
      if (!r.mail.dmarc.present) return "なし";
      if (r.mail.dmarc.evidence.length > 1) return `${r.mail.dmarc.evidence.length} 件が重複`;
      return `あり（p=${r.mail.dmarc.policy ?? "不明"}）`;
    }
    case "mail_provider.mx":
      return (
        r.mail.provider.name ?? (r.mail.provider.kind === "onprem" ? "自社管理の可能性" : "不明")
      );
    case "web_hosting.hint":
      return r.web.hosting.name ?? (r.web.hosting.kind === "onprem" ? "自社管理の可能性" : "不明");
    case "cloud_services.spf":
      return hostList(r.cloudServices.map((c) => c.name));
    case "hostnames.ct": {
      if (r.sources.ct === "unavailable") return "参照できず";
      const active = r.hostnames.filter((h) => h.activeCertCount > 0).length;
      return `${r.hostnames.length} 件（有効 ${active}）`;
    }
    case "certificates.expired": {
      const n = r.hostnames.filter(
        (h) => !h.wildcard && h.resolves === true && h.activeCertCount === 0 && h.certCount > 0,
      ).length;
      return `${n} 件`;
    }
    default:
      return "";
  }
}

function stateOf(f: Finding, r: ReconResult): CheckState {
  if (f.severity === "ok") return "ok";
  if (f.severity === "info") return "info";
  if (f.id === "mail_auth.spf" && !r.mail.spf.present) return "bad";
  if (f.id === "mail_auth.dmarc" && !r.mail.dmarc.present) return "bad";
  return "warn";
}

/** 確認項目をカテゴリ順に並べ、1 行ずつのチェックにする */
export function checkRows(result: ReconResult): CheckRow[] {
  const rows: CheckRow[] = [];
  for (const category of CATEGORY_ORDER) {
    for (const f of result.findings.filter((x) => x.category === category)) {
      rows.push({
        id: f.id,
        nameJa: ROW_NAME[f.id] ?? f.titleJa,
        resultJa: ROW_NAME[f.id] ? resultOf(f, result) : "",
        state: stateOf(f, result),
        inferred: INFERRED_CATEGORIES.has(category),
        finding: f,
        candidates:
          f.id === "remote_access.vpn" || f.id === "remote_access.rdp"
            ? result.remoteAccessCandidates.filter(
                (c) => c.kind === (f.id === "remote_access.vpn" ? "vpn" : "rdp"),
              )
            : [],
      });
    }
  }
  return rows;
}

/** 状態ごとの件数（一覧の上の要約） */
export function countStates(rows: CheckRow[]): Record<CheckState, number> {
  const n: Record<CheckState, number> = { ok: 0, warn: 0, bad: 0, info: 0 };
  for (const r of rows) n[r.state] += 1;
  return n;
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
