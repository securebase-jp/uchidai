/**
 * 外部確認の結果をカルテに反映する。
 * - reconToAnswers：最初の 5 問の初期値（画面では「外部から推定」と表示する）
 * - reconToAssetHints：資産の役割ごとに当てはめる属性と緩和策（根拠は external）
 */
import type { Asset, CompanyProfile, Control, ProfileAnswers, Role } from "@uchidai/engine";
import type { ReconResult } from "./types.ts";

export type InferredAnswerKey = "hosting.mail" | "hosting.web" | "remoteAccess";

export interface AnswerHints {
  answers: {
    hosting: Partial<Pick<ProfileAnswers["hosting"], "mail" | "web">>;
    remoteAccess?: ProfileAnswers["remoteAccess"];
  };
  /** 外部から推定した項目（画面で「外部から推定」と表示する） */
  inferred: InferredAnswerKey[];
  reasonsJa: Partial<Record<InferredAnswerKey, string>>;
}

export function reconToAnswers(result: ReconResult): AnswerHints {
  const hints: AnswerHints = { answers: { hosting: {} }, inferred: [], reasonsJa: {} };

  if (result.mail.provider.kind !== "unknown") {
    hints.answers.hosting.mail = result.mail.provider.kind;
    hints.inferred.push("hosting.mail");
    hints.reasonsJa["hosting.mail"] = result.mail.provider.reasonJa;
  }
  if (result.web.hosting.kind !== "unknown") {
    hints.answers.hosting.web = result.web.hosting.kind;
    hints.inferred.push("hosting.web");
    hints.reasonsJa["hosting.web"] = result.web.hosting.reasonJa;
  }
  // 過去の痕跡（DNS になく証明書も期限切れ）は、今の社外接続の推定には使わない
  const current = result.remoteAccessCandidates.filter((c) => c.current);
  const kinds = new Set(current.map((c) => c.kind));
  if (kinds.size > 0) {
    const remote: ProfileAnswers["remoteAccess"] = [];
    if (kinds.has("vpn")) remote.push("vpn");
    if (kinds.has("rdp")) remote.push("rdp");
    hints.answers.remoteAccess = remote;
    hints.inferred.push("remoteAccess");
    hints.reasonsJa.remoteAccess = current.map((c) => `${c.hostname}（${c.reasonJa}）`).join("、");
  }
  return hints;
}

/** 5 問の回答に推定値を重ねる。担当者が既に答えた項目（unknown 以外）は上書きしない */
export function mergeAnswers(
  current: ProfileAnswers,
  hints: AnswerHints,
): { answers: ProfileAnswers; applied: InferredAnswerKey[] } {
  const answers: ProfileAnswers = {
    ...current,
    hosting: { ...current.hosting },
    remoteAccess: [...current.remoteAccess],
  };
  const applied: InferredAnswerKey[] = [];
  const { mail, web } = hints.answers.hosting;
  if (mail && current.hosting.mail === "unknown") {
    answers.hosting.mail = mail;
    applied.push("hosting.mail");
  }
  if (web && current.hosting.web === "unknown") {
    answers.hosting.web = web;
    applied.push("hosting.web");
  }
  if (hints.answers.remoteAccess) {
    const onlyUnknown =
      current.remoteAccess.length === 0 || current.remoteAccess.every((r) => r === "unknown");
    const additions = hints.answers.remoteAccess.filter((r) => !current.remoteAccess.includes(r));
    if (additions.length > 0) {
      answers.remoteAccess = onlyUnknown ? [...additions] : [...current.remoteAccess, ...additions];
      applied.push("remoteAccess");
    }
  }
  return { answers, applied };
}

export interface AssetHint {
  role: Role;
  attrs: Asset["attrs"];
  attrEvidence: Record<string, "external">;
  controls: Control[];
  /** 根拠となったホスト名（表示用） */
  hostnames: string[];
  reasonJa: string;
}

export function reconToAssetHints(result: ReconResult): AssetHint[] {
  const hints: AssetHint[] = [];
  const vpn = result.remoteAccessCandidates.filter((c) => c.kind === "vpn" && c.current);
  if (vpn.length > 0) {
    const first = vpn[0];
    hints.push({
      role: "entry.vpn",
      attrs: { exposed: true, ...(first ? { hostname: first.hostname } : {}) },
      attrEvidence: { exposed: "external", ...(first ? { hostname: "external" } : {}) },
      controls: [
        {
          mitigation: "M1042",
          status: "absent",
          evidence: "external",
          noteJa: `外部確認：VPN 用と推定されるホスト名が公開されている（${vpn.map((c) => c.hostname).join("、")}）`,
        },
      ],
      hostnames: vpn.map((c) => c.hostname),
      reasonJa: vpn.map((c) => c.reasonJa).join("。"),
    });
  }
  const rdp = result.remoteAccessCandidates.filter((c) => c.kind === "rdp" && c.current);
  if (rdp.length > 0) {
    const first = rdp[0];
    hints.push({
      role: "entry.rdp",
      attrs: { exposed: true, ...(first ? { hostname: first.hostname } : {}) },
      attrEvidence: { exposed: "external", ...(first ? { hostname: "external" } : {}) },
      controls: [],
      hostnames: rdp.map((c) => c.hostname),
      reasonJa: rdp.map((c) => c.reasonJa).join("。"),
    });
  }
  const mailAttrs: Asset["attrs"] = {
    spf: result.mail.spf.present,
    dmarc: result.mail.dmarc.present,
  };
  const mailEvidence: Record<string, "external"> = { spf: "external", dmarc: "external" };
  if (result.mail.dmarc.policy) {
    mailAttrs.dmarcPolicy = result.mail.dmarc.policy;
    mailEvidence.dmarcPolicy = "external";
  }
  if (result.mail.provider.name) {
    mailAttrs.mailProvider = result.mail.provider.name;
    mailEvidence.mailProvider = "external";
  }
  hints.push({
    role: "cloud.mail",
    attrs: mailAttrs,
    attrEvidence: mailEvidence,
    controls: [],
    hostnames: result.mail.mx.map((m) => m.exchange),
    reasonJa: `SPF ${result.mail.spf.present ? "あり" : "なし"}、DMARC ${result.mail.dmarc.present ? `あり（p=${result.mail.dmarc.policy ?? "不明"}）` : "なし"}。${result.mail.provider.reasonJa}`,
  });
  if (result.web.hosting.kind !== "unknown" || result.web.records.length > 0) {
    const attrs: Asset["attrs"] = { exposed: true };
    const evidence: Record<string, "external"> = { exposed: "external" };
    if (result.web.hosting.name) {
      attrs.hostingProvider = result.web.hosting.name;
      evidence.hostingProvider = "external";
    }
    hints.push({
      role: "entry.web",
      attrs,
      attrEvidence: evidence,
      controls: [],
      hostnames: result.web.hostnames,
      reasonJa: result.web.hosting.reasonJa,
    });
  }
  return hints;
}

/**
 * 資産のヒントをカルテに重ねる。役割が一致する資産に属性と緩和策を書き込む（根拠 external は最優先）。
 * 一致する資産が無い役割は何もしない（資産を増やすかは担当者の判断）。
 * 緩和策は、前回の外部確認（evidence external）の記録だけを置き換え、担当者登録・ベンダー回答の記録は残す。
 * 残した記録と食い違えば engine（resolveControl）が矛盾として表示し、根拠の優先順位（外部確認が最上位）で判定する。
 * 属性（attrs）は 1 値なので上書きされる。登録値との食い違いは、重ねる前に findContradictions で拾う。
 * 廃止済み（attrs.decommissioned = true）の資産には重ねない（ホームページの置き場所などは現役の資産の属性。残っている名前は矛盾として出す）
 */
export function applyAssetHints(profile: CompanyProfile, hints: AssetHint[]): CompanyProfile {
  const assets = profile.assets.map((asset) => {
    if (asset.attrs.decommissioned === true) return asset;
    const matching = hints.filter((h) => h.role === asset.role);
    if (matching.length === 0) return asset;
    let next: Asset = {
      ...asset,
      attrs: { ...asset.attrs },
      attrEvidence: { ...asset.attrEvidence },
      controls: [...asset.controls],
    };
    for (const hint of matching) {
      next = {
        ...next,
        attrs: { ...next.attrs, ...hint.attrs },
        attrEvidence: { ...next.attrEvidence, ...hint.attrEvidence },
        controls: [
          ...next.controls.filter(
            (c) =>
              c.evidence !== "external" ||
              !hint.controls.some((h) => h.mitigation === c.mitigation),
          ),
          ...hint.controls,
        ],
      };
    }
    return next;
  });
  return { ...profile, assets };
}
