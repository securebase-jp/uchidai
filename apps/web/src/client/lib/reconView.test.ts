import { describe, expect, it } from "vitest";
import type { AppliedView, ReconResult } from "./reconApi.ts";
import { parseReconHints } from "./reconHints.ts";
import {
  applyChanges,
  applyRows,
  checkRows,
  countStates,
  ctSourceIds,
  ctSourceLabel,
} from "./reconView.ts";
import type { CompanyProfile } from "./types.ts";

const result = {
  domain: "demo-seiko.example",
  checkedAt: "2026-11-03T00:00:00Z",
  sources: { dns: "fixture", ct: "unavailable" },
  ownership: {
    domain: "demo-seiko.example",
    record: "uchidai-verify=x",
    verifiedAt: "2026-11-03T00:00:00Z",
    source: "fixture",
  },
  hostnames: [],
  remoteAccessCandidates: [],
  mail: {
    mx: [],
    spf: { present: true, includes: [], evidence: [] },
    dmarc: { present: false, evidence: [] },
    provider: { kind: "unknown", reasonJa: "MX なし", evidence: [] },
  },
  cloudServices: [],
  web: { hostnames: [], records: [], hosting: { kind: "unknown", reasonJa: "不明", evidence: [] } },
  findings: [
    {
      id: "web_hosting.hint",
      category: "web_hosting",
      severity: "info",
      titleJa: "ホームページの置き場所は不明",
      detailJa: "",
      evidence: [],
      ipaCases: [],
    },
    {
      id: "mail_auth.dmarc",
      category: "mail_auth",
      severity: "warn",
      titleJa: "DMARC なし",
      detailJa: "_dmarc の TXT が無い",
      evidence: [{ kind: "dns", recordType: "TXT", name: "_dmarc.demo-seiko.example", value: "" }],
      ipaCases: [],
    },
    {
      id: "remote_access.vpn",
      category: "remote_access",
      severity: "warn",
      titleJa: "VPN 用と推定されるホスト名",
      detailJa: "vpn.demo-seiko.example",
      evidence: [],
      ipaCases: [8, 9],
    },
  ],
  notesJa: ["証明書の公開ログ（crt.sh）を参照できなかった: timeout"],
} as unknown as ReconResult;

describe("ctSourceLabel", () => {
  it("実際に使った検索先の名前を出す。予備を使ったときはそう分かる", () => {
    expect(ctSourceLabel({ dns: "live", ct: "live", ctProvider: "crtsh" })).toBe("crt.sh");
    expect(ctSourceLabel({ dns: "live", ct: "live" })).toBe("crt.sh");
    expect(ctSourceLabel({ dns: "live", ct: "live", ctProvider: "certspotter" })).toBe(
      "Cert Spotter。crt.sh で得られなかったため",
    );
    expect(ctSourceLabel({ dns: "fixture", ct: "fixture" })).toBe("記録");
    expect(ctSourceLabel({ dns: "live", ct: "unavailable" })).toBe("今回は取得できず");
  });
});

describe("checkRows / countStates", () => {
  it("カテゴリの固定順に並べ、推定のカテゴリに印を付ける", () => {
    const rows = checkRows(result);
    expect(rows.map((r) => r.id)).toEqual([
      "remote_access.vpn",
      "mail_auth.dmarc",
      "web_hosting.hint",
    ]);
    expect(rows[0]?.inferred).toBe(true);
    expect(rows[1]?.inferred).toBe(false);
    expect(rows[0]?.finding.ipaCases).toEqual([8, 9]);
  });
  it("項目名と結果は短く、DMARC が無ければ「問題あり」、VPN の公開は「要確認」", () => {
    const rows = checkRows(result);
    expect(rows.map((r) => [r.nameJa, r.resultJa, r.state])).toEqual([
      ["VPN 用ホスト", "見つからず", "warn"],
      ["DMARC", "なし", "bad"],
      ["ホームページの置き場所", "不明", "info"],
    ]);
  });
  it("VPN 用と推定されるホスト名が公開されていれば、その名前を結果に出す。3 件目からは件数にまとめる", () => {
    const cand = (hostname: string, current: boolean) => ({
      hostname,
      kind: "vpn" as const,
      pattern: "p",
      current,
      reasonJa: "",
      evidence: [],
      ipaCases: [],
    });
    const r = {
      ...result,
      remoteAccessCandidates: [
        cand("vpn.a.example", true),
        cand("vpn2.a.example", true),
        cand("ssl.a.example", true),
        cand("old.a.example", false),
      ],
    } as unknown as ReconResult;
    expect(checkRows(r)[0]?.resultJa).toBe("vpn.a.example、vpn2.a.example ほか 1 件");
    expect(checkRows(r)[0]?.candidates).toHaveLength(4);
  });
  it("状態ごとに数える", () => {
    expect(countStates(checkRows(result))).toEqual({ ok: 0, warn: 1, bad: 1, info: 1 });
  });
});

describe("ctSourceIds", () => {
  it("使った検索先の出典 id。予備を使ったときは両方、使っていなければ無し", () => {
    expect(ctSourceIds({ dns: "live", ct: "live", ctProvider: "crtsh" })).toEqual(["crtsh"]);
    expect(ctSourceIds({ dns: "live", ct: "live", ctProvider: "certspotter" })).toEqual([
      "certspotter",
      "crtsh",
    ]);
    expect(ctSourceIds({ dns: "fixture", ct: "fixture" })).toEqual([]);
    expect(ctSourceIds({ dns: "live", ct: "unavailable" })).toEqual([]);
  });
});

const before = {
  id: "p",
  companyName: "テスト",
  fictional: false,
  pattern: "office",
  assets: [
    {
      id: "vpn",
      kind: "device",
      role: "entry.vpn",
      label: "VPN装置",
      attrs: { exposed: false },
      attrEvidence: { exposed: "registered" },
      controls: [{ mitigation: "M1032", status: "absent", evidence: "registered" }],
    },
    {
      id: "mail",
      kind: "cloud",
      role: "cloud.mail",
      label: "メール",
      attrs: { spf: true },
      attrEvidence: { spf: "external" },
      controls: [],
    },
  ],
  businesses: [],
  personalData: [],
  answers: {
    industry: "other",
    site: "office_only",
    hosting: { mail: "unknown", files: "unknown", core: "unknown", web: "unknown" },
    remoteAccess: [],
    backup: "unknown",
  },
} as unknown as CompanyProfile;

const applied: AppliedView = {
  profile: {
    ...before,
    domain: "example.jp",
    domainVerified: true,
    assets: [
      {
        ...(before.assets[0] as CompanyProfile["assets"][number]),
        attrs: { exposed: true, hostname: "vpn.example.jp" },
        attrEvidence: { exposed: "external", hostname: "external" },
        controls: [
          { mitigation: "M1032", status: "absent", evidence: "registered" },
          { mitigation: "M1042", status: "absent", evidence: "external", noteJa: "外部確認" },
        ],
      },
      {
        ...(before.assets[1] as CompanyProfile["assets"][number]),
        attrs: { spf: true, dmarc: false },
        attrEvidence: { spf: "external", dmarc: "external" },
      },
    ],
  },
  contradictions: [],
  answers: {
    merged: {
      industry: "other",
      site: "office_only",
      hosting: { mail: "cloud", files: "unknown", core: "unknown", web: "unknown" },
      remoteAccess: ["vpn"],
      backup: "unknown",
    },
    applied: ["hosting.mail", "remoteAccess"],
  },
};

describe("applyChanges（反映の差分）", () => {
  it("上書きされる属性、新しく付く属性、追加される緩和策、5 問の初期値、ドメインを列挙する", () => {
    const d = applyChanges(before, applied);
    expect(d.attrs).toEqual([
      {
        assetId: "vpn",
        assetLabel: "VPN装置",
        key: "exposed",
        before: "なし",
        after: "あり",
        overwrite: true,
      },
      {
        assetId: "vpn",
        assetLabel: "VPN装置",
        key: "hostname",
        before: undefined,
        after: "vpn.example.jp",
        overwrite: false,
      },
      {
        assetId: "mail",
        assetLabel: "メール",
        key: "dmarc",
        before: undefined,
        after: "なし",
        overwrite: false,
      },
    ]);
    expect(d.controls).toEqual([
      {
        assetId: "vpn",
        assetLabel: "VPN装置",
        mitigation: "M1042",
        status: "absent",
        noteJa: "外部確認",
      },
    ]);
    expect(d.answers).toEqual([
      { key: "hosting.mail", labelJa: "メールの置き場所", after: "クラウドサービス" },
      { key: "remoteAccess", labelJa: "社外からのつなぎ方", after: "VPN装置" },
    ]);
    expect(d.domainChange).toEqual({ before: undefined, after: "example.jp" });
  });
  it("差分を表の行にする：5 問、属性、緩和策、ドメインの順で、種類は上書き・新しく付く・記録を追加", () => {
    const rows = applyRows(applyChanges(before, applied), before);
    expect(rows.map((r) => [r.componentJa, r.itemJa, r.before, r.after, r.kind])).toEqual([
      ["最初の5問", "メールの置き場所", undefined, "クラウドサービス", "new"],
      ["最初の5問", "社外からのつなぎ方", undefined, "VPN装置", "new"],
      ["VPN装置", "exposed", "なし", "あり", "overwrite"],
      ["VPN装置", "hostname", undefined, "vpn.example.jp", "new"],
      ["メール", "dmarc", undefined, "なし", "new"],
      ["VPN装置", "M1042", undefined, "なし", "add"],
      ["会社", "ドメイン", undefined, "example.jp", "new"],
    ]);
    expect(rows[0]?.tagJa).toBe("外部から推定");
  });
  it("同じ値が既に外部確認で入っていれば差分にしない", () => {
    const same: AppliedView = { profile: before, contradictions: applied.contradictions };
    const d = applyChanges(before, same);
    expect(d.attrs).toEqual([]);
    expect(d.controls).toEqual([]);
    expect(d.answers).toEqual([]);
    expect(d.domainChange).toBeUndefined();
  });
});

describe("parseReconHints（localStorage の検証）", () => {
  it("正しい形は読み、壊れた形は捨てる", () => {
    const good = {
      domain: "example.jp",
      fixture: false,
      checkedAt: "2026-11-03T00:00:00Z",
      answersHints: {
        answers: { hosting: { mail: "cloud" }, remoteAccess: ["vpn"] },
        inferred: ["hosting.mail", "remoteAccess"],
        reasonsJa: { "hosting.mail": "MX が outlook" },
      },
    };
    expect(parseReconHints(JSON.stringify(good))?.answersHints.inferred).toEqual([
      "hosting.mail",
      "remoteAccess",
    ]);
    expect(parseReconHints("{")).toBeUndefined();
    expect(
      parseReconHints(JSON.stringify({ ...good, answersHints: { inferred: ["x"] } })),
    ).toBeUndefined();
    expect(parseReconHints(null)).toBeUndefined();
  });
});
