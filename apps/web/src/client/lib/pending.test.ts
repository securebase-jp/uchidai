import { describe, expect, it } from "vitest";
import { pathTemplateLabel, rankPending, templateHeading, unknownStepLabels } from "./pending.ts";
import type { AttackPath, CompanyProfile, Graph, Verdict } from "./types.ts";

const profile = {
  id: "t",
  companyName: "テスト製作所",
  fictional: false,
  assets: [
    {
      id: "server",
      kind: "system",
      role: "server",
      label: "業務サーバ区画",
      side: "internal",
      controls: [
        { mitigation: "M1030", status: "unknown", evidence: "none" },
        { mitigation: "M1022", status: "unknown", evidence: "none" },
      ],
      attrs: {},
      attrEvidence: {},
    },
    {
      id: "vpn",
      kind: "device",
      role: "entry.vpn",
      label: "VPN装置",
      side: "internal",
      controls: [
        { mitigation: "M1051", status: "unknown", evidence: "none" },
        { mitigation: "M1032", status: "present", evidence: "registered" },
        { mitigation: "M1042", status: "unknown", evidence: "none" },
      ],
      attrs: {},
      attrEvidence: {},
    },
    {
      id: "mail",
      kind: "system",
      role: "mail",
      label: "クラウドメール",
      side: "external",
      controls: [{ mitigation: "M1032", status: "unknown", evidence: "none" }],
      attrs: {},
      attrEvidence: {},
    },
  ],
  businesses: [],
  personalData: [],
} as unknown as CompanyProfile;

const graph = {
  nodes: [
    {
      id: "n-vpn",
      role: "entry.vpn",
      label: "VPN装置",
      layer: "system",
      side: "internal",
      assetId: "vpn",
    },
    {
      id: "n-server",
      role: "server",
      label: "業務サーバ区画",
      layer: "system",
      side: "internal",
      assetId: "server",
    },
    {
      id: "n-core",
      role: "core",
      label: "生産管理",
      layer: "system",
      side: "internal",
      assetId: "core",
    },
  ],
  edges: [],
} as unknown as Graph;

const step = (
  nodeId: string,
  role: string,
  state: string,
  mitigations: string[],
  labelJa: string,
) =>
  ({
    nodeId,
    role,
    tactic: "TA0001",
    mitigations,
    ineffective: [],
    source: "stated",
    state,
    evidence: "none",
    reasonJa: "",
    labelJa,
  }) as unknown as AttackPath["steps"][number];

const path = (
  id: string,
  templateId: string | undefined,
  source: string,
  steps: AttackPath["steps"],
) =>
  ({
    id,
    ...(templateId ? { templateId } : {}),
    source,
    steps,
    reachedCore: true,
    reachedAssetIds: [],
  }) as unknown as AttackPath;

const verdictWith = (paths: AttackPath[], extra: Partial<Verdict> = {}) =>
  ({
    result: "breached",
    headlineJa: "",
    paths,
    contradictions: [],
    timeline: [],
    ...extra,
  }) as unknown as Verdict;

describe("rankPending（答えると結論が変わりやすい順）", () => {
  it("経路の未確認の段階で問われている緩和策が先頭、入口に近い順。経路の外はカルテの順のまま", () => {
    const v = verdictWith([
      path("ransomware:vpn", "ransomware", "stated", [
        step("n-vpn", "entry.vpn", "unknown", ["M1042", "M1051"], "入口から侵入"),
        step("n-server", "server", "unknown", ["M1030"], "サーバへ広がる"),
        step("n-core", "core", "breached", [], "暗号化"),
      ]),
    ]);
    const r = rankPending(profile, v, graph);
    expect(r.map((x) => `${x.assetId}:${x.mitigation}`)).toEqual([
      "vpn:M1051",
      "vpn:M1042",
      "server:M1030",
      "server:M1022",
      "mail:M1032",
    ]);
    expect(r[0]).toMatchObject({ onPath: true, stageJa: "入口から侵入", position: 0 });
    expect(r[2]).toMatchObject({ onPath: true, stageJa: "サーバへ広がる", position: 1 });
    expect(r[3]?.onPath).toBe(false);
    expect(r[3]?.position).toBeUndefined();
  });

  it("「あり」「なし」が付いた緩和策は含めない。突破された段階の緩和策は経路の外として扱う", () => {
    const v = verdictWith([
      path("ransomware:vpn", "ransomware", "stated", [
        step("n-vpn", "entry.vpn", "breached", ["M1051"], "入口から侵入"),
        step("n-server", "server", "unknown", ["M1030"], "サーバへ広がる"),
      ]),
    ]);
    const r = rankPending(profile, v, graph);
    expect(r.find((x) => x.mitigation === "M1032" && x.assetId === "vpn")).toBeUndefined();
    expect(r[0]).toMatchObject({ assetId: "server", mitigation: "M1030", onPath: true });
    expect(r.find((x) => x.assetId === "vpn" && x.mitigation === "M1051")?.onPath).toBe(false);
  });

  it("AI の経路は数えない。判定が無ければカルテの順", () => {
    const ai = verdictWith([
      path("ai-1", undefined, "ai", [step("n-server", "server", "unknown", ["M1030"], "")]),
    ]);
    expect(rankPending(profile, ai, graph).every((x) => !x.onPath)).toBe(true);
    expect(rankPending(profile, undefined, undefined).map((x) => x.mitigation)).toEqual([
      "M1030",
      "M1022",
      "M1051",
      "M1042",
      "M1032",
    ]);
  });

  it("unknownStepLabels：経路の未確認の段階の構成要素名（重複なし、AI は除く）", () => {
    const v = verdictWith([
      path("a", "ransomware", "stated", [
        step("n-vpn", "entry.vpn", "unknown", [], ""),
        step("n-server", "server", "unknown", [], ""),
      ]),
      path("b", "ransomware", "candidate", [step("n-server", "server", "unknown", [], "")]),
      path("ai-1", undefined, "ai", [step("n-core", "core", "unknown", [], "")]),
    ]);
    expect(unknownStepLabels(v, graph)).toEqual(["VPN装置", "業務サーバ区画"]);
  });
});

const templates = [
  { id: "ransomware", labelJa: "業務停止（ランサムウェア）" },
  { id: "data-breach-intrusion", labelJa: "情報漏えい（社内への侵入・持ち出し）" },
  { id: "data_breach", labelJa: "情報漏えい（不正アクセス・設定ミス）" },
];

describe("templateHeading（判定に使った型紙の見出し）", () => {
  it("1 本に絞れたときは verdict の名前", () => {
    const v = verdictWith([], {
      templateId: "ransomware",
      templateLabelJa: "業務停止（ランサムウェア）",
    });
    expect(templateHeading(v, templates)).toBe("型紙「業務停止（ランサムウェア）」で判定");
  });

  it("入口不明で複数の型紙を展開したときは、経路ごとの型紙を重複なしで全部出す（AI は除く）", () => {
    const v = verdictWith([
      path("data-breach-intrusion:vpn", "data-breach-intrusion", "candidate", []),
      path("data-breach-intrusion:pc", "data-breach-intrusion", "candidate", []),
      path("data_breach:mail", "data_breach", "candidate", []),
      path("ai-1", undefined, "ai", []),
    ]);
    expect(templateHeading(v, templates)).toBe(
      "型紙「情報漏えい（社内への侵入・持ち出し）」「情報漏えい（不正アクセス・設定ミス）」の 2 本で判定（入口が不明なので、当てはまる型紙を全部展開）",
    );
  });

  it("経路の型紙が 1 種類だけなら 1 本の見出し。知らない ID はそのまま。型紙が無ければ空", () => {
    expect(
      templateHeading(verdictWith([path("x:a", "data_breach", "candidate", [])]), templates),
    ).toBe("型紙「情報漏えい（不正アクセス・設定ミス）」で判定");
    expect(
      templateHeading(verdictWith([path("x:a", "unknown-tpl", "candidate", [])]), templates),
    ).toBe("型紙「unknown-tpl」で判定");
    expect(templateHeading(verdictWith([]), templates)).toBe("");
  });

  it("pathTemplateLabel：経路の型紙の名前（無ければ undefined）", () => {
    expect(pathTemplateLabel(path("a", "ransomware", "stated", []), templates)).toBe(
      "業務停止（ランサムウェア）",
    );
    expect(pathTemplateLabel(path("ai-1", undefined, "ai", []), templates)).toBeUndefined();
  });
});
