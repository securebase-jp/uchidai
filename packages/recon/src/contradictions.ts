/**
 * カルテと外部確認の矛盾。登録された内容（registered）と、外から見えるもの（external）が食い違う箇所を返す。
 * 判定は engine が行う。ここでは Contradiction の形で材料だけを作る。
 */
import type { Asset, CompanyProfile, Contradiction } from "@uchidai/engine";
import type { HostnameEntry, ReconResult } from "./types.ts";

function assetHostnames(asset: Asset): string[] {
  const names: string[] = [];
  for (const key of ["hostname", "hostnames"]) {
    const value = asset.attrs[key];
    if (typeof value !== "string") continue;
    for (const part of value.split(/[\s,、]+/)) {
      const name = part.trim().toLowerCase().replace(/\.$/, "");
      if (name) names.push(name);
    }
  }
  return names;
}

function describeExternal(entry: HostnameEntry): string {
  const parts: string[] = [];
  if (entry.resolves) parts.push(`DNS で名前が解決できる（${entry.addresses.join(", ")}）`);
  if (entry.activeCertCount > 0) {
    parts.push(
      `有効期限内の証明書が ${entry.activeCertCount} 件（期限 ${entry.lastExpiry?.slice(0, 10)}）`,
    );
  } else if (entry.certCount > 0) {
    parts.push(`過去に証明書が発行されている（最後の期限 ${entry.lastExpiry?.slice(0, 10)}）`);
  }
  return parts.join("。");
}

/** 外から「生きている」と見えるか：DNS で解決できる、または有効期限内の証明書がある */
function alive(entry: HostnameEntry): boolean {
  return entry.resolves === true || entry.activeCertCount > 0;
}

export function findContradictions(result: ReconResult, profile: CompanyProfile): Contradiction[] {
  const out: Contradiction[] = [];
  const byName = new Map(result.hostnames.map((h) => [h.name, h]));
  // 今も使われている形跡のある VPN 用ホスト名だけを材料にする（過去の痕跡は矛盾の根拠にしない）
  const vpnHosts = result.remoteAccessCandidates.filter((c) => c.kind === "vpn" && c.current);

  for (const asset of profile.assets) {
    // 1. 廃止済みのホスト名が DNS／CT に残っている
    if (asset.attrs.decommissioned === true) {
      for (const name of assetHostnames(asset)) {
        const entry = byName.get(name);
        if (entry && alive(entry)) {
          out.push({
            assetId: asset.id,
            messageJa: `「${asset.label}」はカルテで廃止済みだが、ホスト名 ${name} が外部に残っている可能性がある`,
            external: describeExternal(entry),
            registered: "廃止済み（attrs.decommissioned = true）",
          });
        }
      }
    }

    if (asset.role === "entry.vpn" && vpnHosts.length > 0) {
      const hostList = vpnHosts.map((c) => c.hostname).join("、");
      // 2. 「非公開」（M1042 present）なのに VPN 想定ホスト名がある
      const hidden = asset.controls.find((c) => c.mitigation === "M1042" && c.status === "present");
      if (hidden && hidden.evidence !== "external") {
        out.push({
          assetId: asset.id,
          messageJa: `「${asset.label}」は非公開と登録されているが、VPN 用と推定されるホスト名が公開されている可能性がある（別の装置の名前である可能性もある）`,
          external: `VPN 用と推定されるホスト名: ${hostList}`,
          registered: `M1042（非公開化）あり（根拠: ${hidden.evidence}）${hidden.noteJa ? `。${hidden.noteJa}` : ""}`,
        });
      }
      // 3. 公開していない（exposed = false）と登録
      if (asset.attrs.exposed === false && asset.attrEvidence.exposed !== "external") {
        out.push({
          assetId: asset.id,
          messageJa: `「${asset.label}」は外部に公開していないと登録されているが、VPN 用と推定されるホスト名が公開されている可能性がある（別の装置の名前である可能性もある）`,
          external: `VPN 用と推定されるホスト名: ${hostList}`,
          registered: "attrs.exposed = false",
        });
      }
    }

    // 4. メール認証の登録値と外部確認の食い違い（登録由来のものだけ）
    if (asset.role === "cloud.mail") {
      const checks: [string, boolean | undefined, boolean, string][] = [
        [
          "spf",
          asset.attrs.spf === undefined ? undefined : asset.attrs.spf === true,
          result.mail.spf.present,
          "SPF",
        ],
        [
          "dmarc",
          asset.attrs.dmarc === undefined ? undefined : asset.attrs.dmarc === true,
          result.mail.dmarc.present,
          "DMARC",
        ],
      ];
      for (const [key, registered, external, labelJa] of checks) {
        if (registered === undefined || asset.attrEvidence[key] === "external") continue;
        if (registered !== external) {
          out.push({
            assetId: asset.id,
            messageJa: `「${asset.label}」の ${labelJa} はカルテで「${registered ? "あり" : "なし"}」だが、DNS では「${external ? "あり" : "なし"}」`,
            external: external
              ? ((key === "spf" ? result.mail.spf.record : result.mail.dmarc.record) ??
                "レコードあり")
              : `${key === "spf" ? result.domain : `_dmarc.${result.domain}`} に該当する TXT レコードなし`,
            registered: `attrs.${key} = ${String(registered)}`,
          });
        }
      }
    }
  }
  return out;
}
