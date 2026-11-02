/**
 * 資産に外部確認が付けた「ホスト名の状況」を 1 行ずつの文にする（純粋な関数。判定はしない）。
 * - 廃止済みの資産：外部にホスト名が残っているか（attrs.externallySeen。engine が矛盾として出す材料）、最後の証明書の期限
 * - 現役の資産：証明書の最後の期限（attrs.certExpiry）。期限切れ、30 日以内は注意。参考情報であり判定には使わない
 * 根拠が external の属性だけを見る（担当者が手で付けた値は見せない）
 */
import type { CompanyProfile } from "./types.ts";

type Asset = CompanyProfile["assets"][number];

export type HostStatusLine = {
  tone: "red" | "amber" | "green" | "ink";
  labelJa: string;
  detailJa?: string;
};

/** 証明書の期限がこの日数以内なら注意 */
export const CERT_WARN_DAYS = 30;
const DAY_MS = 86_400_000;

function external(asset: Asset, key: string): string | boolean | number | undefined {
  return asset.attrEvidence[key] === "external" ? asset.attrs[key] : undefined;
}
const dateJa = (iso: string): string => iso.slice(0, 10);

function daysUntil(iso: string, now: Date): number | undefined {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return undefined;
  return Math.floor((t - now.getTime()) / DAY_MS);
}

export function hostStatusLines(asset: Asset, now: Date): HostStatusLine[] {
  const lines: HostStatusLine[] = [];
  const hostname = typeof asset.attrs.hostname === "string" ? asset.attrs.hostname : undefined;
  const seen = external(asset, "externallySeen");
  const seenAt = external(asset, "externallySeenAt");
  const when = typeof seenAt === "string" ? `${dateJa(seenAt)} 時点の外部確認` : "外部確認";

  if (asset.attrs.decommissioned === true) {
    if (seen === true) {
      lines.push({
        tone: "red",
        labelJa: "外部にホスト名が残っている可能性",
        detailJa: `${hostname ? `${hostname} が DNS または証明書の公開ログに残っている` : "DNS または証明書の公開ログに残っている"}（${when}）。判定で矛盾として扱います`,
      });
    } else if (seen === false) {
      lines.push({
        tone: "green",
        labelJa: "外部にホスト名は残っていない",
        detailJa: `${hostname ?? "ホスト名"} は DNS にも有効な証明書にも見当たらない（${when}）`,
      });
    }
    const last = external(asset, "lastCertExpiry");
    if (typeof last === "string") {
      const days = daysUntil(last, now);
      lines.push(
        days !== undefined && days < 0
          ? { tone: "ink", labelJa: `証明書：期限切れ（${dateJa(last)}）` }
          : {
              tone: "amber",
              labelJa: `証明書：有効（期限 ${dateJa(last)}）`,
              detailJa: "廃止済みなのに有効な証明書が発行されている",
            },
      );
    }
    return lines;
  }

  const expiry = external(asset, "certExpiry");
  if (typeof expiry === "string") {
    const days = daysUntil(expiry, now);
    const wildcard =
      external(asset, "certWildcard") === true && hostname
        ? `ワイルドカード証明書（*.${hostname.split(".").slice(1).join(".")}）。`
        : "";
    if (days === undefined) {
      lines.push({
        tone: "ink",
        labelJa: `証明書：期限 ${expiry}`,
        ...(wildcard ? { detailJa: wildcard } : {}),
      });
    } else if (days < 0) {
      lines.push({
        tone: "red",
        labelJa: `証明書：期限切れ（${dateJa(expiry)}）`,
        detailJa: `${wildcard}公開ログに新しい証明書の記録がない。更新忘れか、使っていないのに名前が残っている可能性（参考情報。判定には使いません）`,
      });
    } else if (days <= CERT_WARN_DAYS) {
      lines.push({
        tone: "amber",
        labelJa: `証明書：期限 ${dateJa(expiry)}（あと ${days} 日）`,
        detailJa: `${wildcard}${CERT_WARN_DAYS} 日以内に切れます。更新の予定を確かめてください（参考情報。判定には使いません）`,
      });
    } else {
      lines.push({
        tone: "ink",
        labelJa: `証明書：有効（期限 ${dateJa(expiry)}）`,
        ...(wildcard ? { detailJa: `${wildcard}配下の個別の名前は公開ログからは分からない` } : {}),
      });
    }
  }
  return lines;
}
