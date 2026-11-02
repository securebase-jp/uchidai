/**
 * 構成グラフの生成：会社カルテ（資産・業務・回答）→ Graph
 * 判定、経路探索、AI攻撃者の検証、描画はすべてこのグラフの上で行う。手で座標を置いた固定の図は持たない
 */
import type { Pattern, RoleDef } from "./knowledge.ts";
import type {
  Asset,
  CompanyProfile,
  Control,
  Graph,
  GraphEdge,
  GraphNode,
  ProfileAnswers,
  Role,
} from "./types.ts";

export const ATTACKER_NODE_ID = "attacker";

/** 役割どうしの通信のつながり（役割の枠で定義し、会社ごとの資産に展開する） */
const NETWORK_LINKS: [Role, Role][] = [
  ["attacker", "entry.vpn"],
  ["attacker", "entry.rdp"],
  ["attacker", "entry.vendor_remote"],
  ["attacker", "entry.web"],
  ["attacker", "cloud.mail"],
  ["attacker", "pc"],
  ["attacker", "cloud.mail_account.exec"],
  ["attacker", "cloud.storage"],
  ["entry.vpn", "pc"],
  ["entry.vpn", "admin"],
  ["entry.vpn", "server"],
  ["entry.rdp", "pc"],
  ["entry.rdp", "admin"],
  ["entry.rdp", "server"],
  ["cloud.mail", "pc"],
  ["cloud.mail", "cloud.mail_account.exec"],
  ["pc", "admin"],
  ["pc", "server"],
  ["admin", "server"],
  ["server", "core"],
  ["server", "file_server"],
  ["server", "backup"],
  ["backup", "core"],
  ["cloud.mail_account.exec", "person.accounting"],
  ["cloud.mail_account.exec", "person.exec"],
  ["cloud.mail_account.exec", "person.staff"],
  ["person.accounting", "cloud.accounting"],
  ["pc", "cloud.storage"],
];

export function roleDefOf(role: Role, roles: RoleDef[]): RoleDef | undefined {
  return roles.find((r) => r.id === role);
}

function edge(from: string, to: string, kind: GraphEdge["kind"], labelJa?: string): GraphEdge {
  return { id: `${from}->${to}`, from, to, kind, ...(labelJa ? { labelJa } : {}) };
}

export function buildGraph(profile: CompanyProfile, roles: RoleDef[]): Graph {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  const addEdge = (e: GraphEdge) => {
    if (e.from === e.to || seen.has(e.id)) return;
    seen.add(e.id);
    edges.push(e);
  };

  nodes.push({
    id: ATTACKER_NODE_ID,
    role: "attacker",
    label: "攻撃者",
    layer: "system",
    side: "external",
  });

  for (const a of profile.assets) {
    const def = roleDefOf(a.role, roles);
    nodes.push({
      id: a.id,
      role: a.role,
      label: a.label,
      layer: "system",
      side: a.side ?? def?.side ?? "internal",
      assetId: a.id,
    });
  }

  const byRole = (role: Role) => nodes.filter((n) => n.role === role);
  for (const [r1, r2] of NETWORK_LINKS) {
    for (const n1 of byRole(r1))
      for (const n2 of byRole(r2)) addEdge(edge(n1.id, n2.id, "network"));
  }
  // 社内に置いたホームページだけが社内のサーバ区画・管理者権限につながる（事業者側のホームページは社内へつながらない）
  for (const web of byRole("entry.web").filter((n) => n.side === "internal")) {
    for (const s of byRole("server")) addEdge(edge(web.id, s.id, "network"));
    for (const a of byRole("admin")) addEdge(edge(web.id, a.id, "network"));
  }
  // 保守ベンダーの遠隔接続は、属性 connectsTo の資産（既定は中核システム）に直接つながる
  for (const a of profile.assets.filter((x) => x.role === "entry.vendor_remote")) {
    const target = String(a.attrs.connectsTo ?? "");
    const targets = profile.assets.filter(
      (x) => x.id === target || (!target && x.role === "core") || x.role === target,
    );
    for (const t of targets) addEdge(edge(a.id, t.id, "network", "遠隔保守"));
    if (targets.length === 0)
      for (const c of byRole("core")) addEdge(edge(a.id, c.id, "network", "遠隔保守"));
  }

  const businesses = profile.businesses.slice(0, 5);
  for (const b of businesses) {
    nodes.push({
      id: b.id,
      role: "business",
      label: b.name,
      layer: "business",
      side: "internal",
      businessId: b.id,
    });
    for (const assetId of b.assetIds)
      if (profile.assets.some((a) => a.id === assetId)) addEdge(edge(b.id, assetId, "depends"));
  }

  const affected = businesses.filter((b) => b.affectsJa);
  if (affected.length > 0) {
    nodes.push({
      id: "impact.partner",
      role: "impact.partner",
      label: "取引先への影響",
      layer: "management",
      side: "external",
    });
    for (const b of affected) addEdge(edge(b.id, "impact.partner", "impacts", b.affectsJa));
  }
  if (profile.personalData.length > 0) {
    nodes.push({
      id: "impact.legal",
      role: "impact.legal",
      label: "個人情報保護委員会への報告",
      layer: "management",
      side: "external",
    });
    for (const p of profile.personalData)
      if (profile.assets.some((a) => a.id === p.assetId))
        addEdge(edge(p.assetId, "impact.legal", "impacts", p.descriptionJa));
  }
  const hasAccounting = profile.assets.some((a) => a.role === "person.accounting");
  if (hasAccounting) {
    nodes.push({
      id: "impact.money",
      role: "impact.money",
      label: "資金の流出",
      layer: "management",
      side: "internal",
    });
    for (const n of byRole("person.accounting"))
      addEdge(edge(n.id, "impact.money", "impacts", "送金"));
  }
  if (
    profile.dailyRevenue !== undefined &&
    nodes.filter((n) => n.layer === "management").length < 3
  ) {
    nodes.push({
      id: "impact.revenue",
      role: "impact.revenue",
      label: "売上影響",
      layer: "management",
      side: "internal",
    });
    for (const b of businesses.filter((x) => x.recoveryDays > 0))
      addEdge(edge(b.id, "impact.revenue", "impacts"));
  }

  return { nodes, edges };
}

/** 2 つのノードが通信エッジで直接つながっているか（向きは問わない） */
export function adjacent(graph: Graph, a: string, b: string): boolean {
  if (a === b) return true;
  return graph.edges.some(
    (e) => e.kind === "network" && ((e.from === a && e.to === b) || (e.from === b && e.to === a)),
  );
}

/** 経路が進める隣接：通信エッジ、または経営への影響（impacts）のエッジ（資金の流出など終点の段階に使う） */
export function connected(graph: Graph, a: string, b: string): boolean {
  if (adjacent(graph, a, b)) return true;
  return graph.edges.some(
    (e) => e.kind === "impacts" && ((e.from === a && e.to === b) || (e.from === b && e.to === a)),
  );
}

// ---------------------------------------------------------------------------
// 最初の5問 → 会社カルテ（資産は役割の枠だけ。詳細は未確認として残す）
// ---------------------------------------------------------------------------
const unknownControls = (ids: string[]): Control[] =>
  ids.map((mitigation) => ({ mitigation, status: "unknown", evidence: "none" }));

function asset(
  id: string,
  role: Role,
  label: string,
  kind: Asset["kind"],
  controls: string[],
  extra: Partial<Asset> = {},
): Asset {
  return {
    id,
    kind,
    role,
    label,
    controls: unknownControls(controls),
    attrs: {},
    attrEvidence: {},
    ...extra,
  };
}

export function profileFromAnswers(
  answers: ProfileAnswers,
  patterns: Pattern[],
  companyName = "（会社名未設定）",
): CompanyProfile {
  const patternId =
    answers.industry === "manufacturing"
      ? "manufacturing"
      : answers.industry === "healthcare"
        ? "healthcare"
        : "office";
  const pattern = patterns.find((p) => p.id === patternId);
  if (!pattern) throw new Error(`構成パターン ${patternId} が knowledge/profiles にない`);

  const assets: Asset[] = [];
  const coreSide =
    answers.hosting.core === "cloud" || answers.hosting.core === "provider"
      ? "external"
      : "internal";
  assets.push(
    asset(
      "core",
      "core",
      pattern.core.labelJa,
      "system",
      coreSide === "external" ? ["M1032"] : [],
      { side: coreSide },
    ),
  );
  if (coreSide === "internal") {
    assets.push(asset("server", "server", "業務サーバ区画", "system", ["M1030", "M1035"]));
  }
  assets.push(asset("pc", "pc", "社員PC", "device", ["M1040", "M1049"]));
  assets.push(asset("admin", "admin", "管理者アカウント", "account", ["M1026", "M1040"]));

  if (answers.hosting.mail !== "onprem") {
    assets.push(
      asset("cloud-mail", "cloud.mail", "クラウドメール", "system", ["M1032"], {
        side: "external",
      }),
    );
    assets.push(
      asset(
        "exec-mail-account",
        "cloud.mail_account.exec",
        "社長のメールアカウント",
        "account",
        ["M1032", "M1027"],
        { side: "external" },
      ),
    );
  }
  if (answers.hosting.files === "onprem" || answers.hosting.files === "unknown") {
    assets.push(asset("file-server", "file_server", "ファイルサーバ", "system", []));
  } else {
    assets.push(
      asset("cloud-storage", "cloud.storage", "クラウドストレージ", "system", ["M1022", "M1047"], {
        side: "external",
      }),
    );
  }
  if (answers.hosting.web === "onprem") {
    assets.push(asset("web", "entry.web", "公開ホームページ（社内）", "system", ["M1051"]));
  } else {
    assets.push(
      asset("web", "entry.web", "公開ホームページ", "system", ["M1051"], { side: "external" }),
    );
  }

  const remote = new Set(answers.remoteAccess);
  if (remote.has("vpn") || remote.has("unknown"))
    assets.push(asset("vpn", "entry.vpn", "VPN装置", "device", ["M1051", "M1032", "M1042"]));
  if (remote.has("rdp") || remote.has("unknown"))
    assets.push(
      asset("rdp", "entry.rdp", "リモートデスクトップ", "device", ["M1042", "M1032", "M1035"]),
    );
  if (remote.has("vendor_remote") || remote.has("unknown")) {
    assets.push(
      asset(
        "vendor-remote",
        "entry.vendor_remote",
        "保守ベンダーの遠隔接続",
        "device",
        ["M1032", "UD-02", "M1035"],
        {
          side: "external",
          attrs: { connectsTo: "core" },
          attrEvidence: { connectsTo: "registered" },
        },
      ),
    );
  }

  const backupAttrs: Record<string, string | boolean> =
    answers.backup === "isolated"
      ? { method: "isolated", isolated: true }
      : answers.backup === "cloud_sync"
        ? { method: "cloud_sync", isolated: false }
        : answers.backup === "same_network"
          ? { method: "same_network", isolated: false }
          : answers.backup === "none"
            ? { method: "none", isolated: false }
            : {};
  if (answers.backup !== "none") {
    const known = answers.backup !== "unknown";
    assets.push({
      id: "backup",
      kind: "system",
      role: "backup",
      label:
        answers.backup === "isolated"
          ? "バックアップ（切り離した保管先）"
          : answers.backup === "cloud_sync"
            ? "バックアップ（クラウド同期）"
            : "バックアップ",
      side: answers.backup === "cloud_sync" ? "external" : "internal",
      controls: known
        ? [{ mitigation: "M1053", status: "present", evidence: "registered" }]
        : unknownControls(["M1053"]),
      attrs: backupAttrs,
      attrEvidence: Object.fromEntries(Object.keys(backupAttrs).map((k) => [k, "registered"])),
    });
  }

  assets.push(asset("exec", "person.exec", "社長", "person", []));
  assets.push(
    asset("accounting-staff", "person.accounting", "経理担当", "person", ["UD-01", "M1017"]),
  );

  const assetIdsByRole = (roleList: Role[]) =>
    assets.filter((a) => roleList.includes(a.role)).map((a) => a.id);
  const businesses = pattern.businesses
    .map((b) => ({
      id: b.id,
      name: b.name,
      assetIds: assetIdsByRole(b.roles),
      manualDays: b.manualDays,
      recoveryDays: b.recoveryDays,
      ...(b.recoveryDaysWithBackup !== undefined
        ? { recoveryDaysWithBackup: b.recoveryDaysWithBackup }
        : {}),
      ...(b.affectsJa ? { affectsJa: b.affectsJa } : {}),
    }))
    .filter((b) => b.assetIds.length > 0);

  return {
    id: "from-answers",
    companyName,
    fictional: false,
    domainVerified: false,
    pattern: patternId,
    answers,
    assets,
    businesses,
    personalData: [],
  };
}
