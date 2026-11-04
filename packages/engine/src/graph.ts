/**
 * 構成グラフの生成：会社カルテ（資産・業務・回答）→ Graph
 * 判定、経路探索、AI攻撃者の検証、描画はすべてこのグラフの上で行う。手で座標を置いた固定の図は持たない
 */
import {
  type IndustryOption,
  loadIndustries,
  type Pattern,
  type RoleDef,
  type SiteOption,
} from "./knowledge.ts";
import type {
  Asset,
  CompanyProfile,
  Control,
  Graph,
  GraphEdge,
  GraphNode,
  PatternId,
  ProfileAnswers,
  Role,
} from "./types.ts";

export const ATTACKER_NODE_ID = "attacker";

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
  // 役割どうしの通信のつながりは roles.yaml の links（役割の枠で定義し、会社ごとの資産に展開する）
  for (const def of roles)
    for (const to of def.links)
      for (const n1 of byRole(def.id))
        for (const n2 of byRole(to)) addEdge(edge(n1.id, n2.id, "network"));
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
    nodes.filter((n) => n.layer === "management").length < 4
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

/**
 * 業種の回答 → 構成パターン。対応は questions.yaml の industry の pattern が決める。
 * 選択肢にない業種は「その他（other）」の構成パターン、それも無ければ office
 */
export function patternIdOf(
  industry: ProfileAnswers["industry"],
  industries: IndustryOption[] = loadIndustries(),
): PatternId {
  return (
    industries.find((o) => o.value === industry)?.pattern ??
    industries.find((o) => o.value === "other")?.pattern ??
    "office"
  );
}

/** 業務の層の上限（buildGraph が描くのは先頭の 5 つ） */
export const MAX_BUSINESSES = 5;

/**
 * 構成パターンの業務に、「現場」の回答が決める現場の業務を足す。
 * 構成パターンに同じ業務（製造業の「生産ライン」、医療の「診療」など）が既にあるときは、足さずに置き換える
 * （replaces に業務 ID を持たせた現場だけ）。同じ役割の業務はほぼ全部ある（役割は core ばかり）ので、役割では
 * 重複を判定せず、業務ごとに明示する。置き換えると位置と ID はパターンのまま、名前と日数と影響先は現場の値になる。
 * パターンの業務は最大 4 つ（knowledge.ts）なので、足しても 5 を超えない
 */
export function withSiteBusiness<B extends { id: string; name: string }>(
  patternBusinesses: B[],
  site: SiteOption | undefined,
  toBusiness: (b: B | undefined, s: NonNullable<SiteOption["siteBusiness"]>) => B,
): B[] {
  const sb = site?.siteBusiness;
  if (!sb) return patternBusinesses;
  const hit = patternBusinesses.find((b) => sb.replaces.includes(b.id) || b.name === sb.name);
  if (hit) return patternBusinesses.map((b) => (b === hit ? toBusiness(b, sb) : b));
  return [...patternBusinesses, toBusiness(undefined, sb)].slice(0, MAX_BUSINESSES);
}

/**
 * 5 問の回答から作った既定の枠だけのカルテか（coverage が answers_only で、資産の ID と役割の組が、回答から作り直したものと同じか）。
 * 既定の枠は、クラウドの共有設定・SaaS・端末管理などの資産を持たないので、「入口になる資産が無い」ことが
 * 「御社に入口は無い」ことを意味しない（登録が足りないだけかもしれない）。資産を足した詳細なカルテや、手で作り込んだカルテは false
 */
export function isDefaultFrameProfile(
  profile: CompanyProfile,
  patterns: Pattern[],
  sites: SiteOption[] = [],
): boolean {
  if (profile.coverage !== "answers_only" || !profile.answers) return false;
  let frame: CompanyProfile;
  try {
    frame = profileFromAnswers(profile.answers, patterns, profile.companyName, sites, profile.id);
  } catch {
    return false;
  }
  const key = (a: Asset) => `${a.id}:${a.role}`;
  const mine = profile.assets.map(key).sort();
  const base = frame.assets.map(key).sort();
  return mine.length === base.length && mine.every((k, i) => k === base[i]);
}

export function profileFromAnswers(
  answers: ProfileAnswers,
  patterns: Pattern[],
  companyName = "うちの会社",
  /** 「現場」の選択肢（knowledge の sites）。渡さなければ現場の業務は足さない */
  sites: SiteOption[] = [],
  /** カルテの ID。会社ごとに別の ID を付けるのは呼び出し側（依頼や根拠が ID で会社に結びつくため）。既定は固定値 */
  profileId = "from-answers",
): CompanyProfile {
  const patternId = patternIdOf(answers.industry);
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
    assets.push(
      asset("server", "server", "業務サーバ区画", "system", [
        "M1030",
        "M1035",
        "M1022",
        "M1047",
        "M1057",
        "M1031",
      ]),
    );
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
    assets.push(
      asset("file-server", "file_server", "ファイルサーバ", "system", ["M1022", "M1047"]),
    );
  } else {
    assets.push(
      asset("cloud-storage", "cloud.storage", "クラウドストレージ", "system", ["M1022", "M1047"], {
        side: "external",
      }),
    );
  }
  if (answers.hosting.web === "onprem") {
    assets.push(
      asset("web", "entry.web", "公開ホームページ（社内）", "system", ["M1051", "M1032", "M1047"]),
    );
  } else {
    // SaaS 型（Wix・Jimdo など）では CMS の更新も事業者側なので M1051 は問わない。レンタルサーバでは会社側の CMS を問う
    const webControls =
      answers.hosting.web === "cloud" ? ["M1032", "M1047"] : ["M1051", "M1032", "M1047"];
    assets.push(
      asset("web", "entry.web", "公開ホームページ", "system", webControls, { side: "external" }),
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
  type Biz = Pattern["businesses"][number];
  const patternBusinesses: Biz[] = pattern.businesses;
  const businesses = withSiteBusiness(
    patternBusinesses,
    sites.find((s) => s.value === answers.site),
    (hit, sb) => ({
      id: hit?.id ?? `biz-site-${answers.site}`,
      name: sb.name,
      roles: sb.roles,
      manualDays: sb.manualDays,
      recoveryDays: sb.recoveryDays,
      ...(sb.recoveryDaysWithBackup !== undefined
        ? { recoveryDaysWithBackup: sb.recoveryDaysWithBackup }
        : {}),
      affectsJa: sb.affectsJa,
    }),
  )
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
    id: profileId,
    companyName,
    fictional: false,
    domainVerified: false,
    pattern: patternId,
    answers,
    coverage: "answers_only",
    assets,
    businesses,
    personalData: pattern.personalData.flatMap((pd) =>
      assets
        .filter((a) => a.role === pd.role)
        .map((a) => ({
          assetId: a.id,
          descriptionJa: pd.descriptionJa,
          over1000: pd.over1000,
          sensitive: pd.sensitive,
        })),
    ),
  };
}
