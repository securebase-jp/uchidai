/**
 * 会社カルテの抽象化：AI攻撃者（Claude）に渡す情報は「役割の枠」と「属性の要約」だけにする。
 * 製品名・バージョン・社名・ホスト名・資産 ID・CVE 番号は含めない（テストで固定）。
 * 緩和策の有無は「あり／なし／未確認」の語で渡す。
 */
import {
  ATTACKER_NODE_ID,
  type CompanyProfile,
  type Graph,
  type LabelsFile,
  type RoleDef,
} from "@uchidai/engine";

export type AbstractedControl = {
  mitigation: string;
  labelJa: string;
  status: "あり" | "なし" | "未確認";
};

export type AbstractedRole = {
  role: string;
  labelJa: string;
  side: "社内" | "社外" | "人";
  /** 通信でつながっている役割（attacker を含む） */
  connectsTo: string[];
  /** 属性の要約（固定の対訳表で日本語化したものだけ） */
  attrsJa: string[];
  controls: AbstractedControl[];
};

export type AbstractedProfile = {
  /** 業種別の構成パターン（manufacturing / construction / office / healthcare） */
  pattern: string;
  roles: AbstractedRole[];
  /** 到達を目標とする役割（型紙の終点） */
  goals: string[];
};

const SIDE_JA = { internal: "社内", external: "社外", person: "人" } as const;
const STATUS_JA = { present: "あり", absent: "なし", unknown: "未確認" } as const;

/**
 * 属性の対訳表。ここにある属性だけを、ここにある語で渡す。
 * 文字列の属性（hostname、cve、product など）は表に無いので自動的に落ちる
 */
const BOOL_ATTRS: Record<string, { true?: string; false?: string }> = {
  exposed: { true: "外部に公開されている", false: "外部に公開されていない" },
  knownExploited: { true: "悪用が確認された脆弱性が残っている" },
  authBypass: { true: "認証を回避できる脆弱性" },
  alwaysOn: { true: "常時接続", false: "必要なときだけ接続" },
  sharedPassword: { true: "共通パスワード" },
  segmented: { false: "区画の分離なし", true: "区画を分離" },
  isolated: { false: "切り離した保管先なし", true: "切り離した保管先あり" },
  restoreTested: { false: "復旧テスト未実施", true: "復旧テスト済み" },
  mfaException: { true: "多要素認証の例外あり" },
  publicLinksDisabled: { true: "公開リンク禁止", false: "公開リンク可" },
  spf: { true: "SPF あり", false: "SPF なし" },
  dmarc: { true: "DMARC あり", false: "DMARC なし" },
  decommissioned: { true: "廃止済み" },
  monitored: { true: "監視あり", false: "監視なし" },
};
const ENUM_ATTRS: Record<string, Record<string, string>> = {
  method: {
    same_network: "同一ネットワークに保管",
    cloud_sync: "クラウド同期型",
    isolated: "切り離した保管先",
    none: "バックアップなし",
  },
  mfaMethod: { app: "多要素認証はアプリ方式", sms: "多要素認証は SMS 方式" },
  reviewCadence: { quarterly: "四半期ごとに棚卸し", yearly: "年 1 回の棚卸し" },
};

function attrsOf(
  attrs: Record<string, string | number | boolean>,
  roleLabel: (role: string) => string | undefined,
  assetRole: (assetId: string) => string | undefined,
): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === "boolean") {
      const t = BOOL_ATTRS[k]?.[v ? "true" : "false"];
      if (t) out.push(t);
      continue;
    }
    if (typeof v === "string") {
      if (k === "connectsTo") {
        // 資産 ID または役割 → 役割の枠の語に置き換える（資産 ID は渡さない）
        const role = assetRole(v) ?? v;
        const label = roleLabel(role);
        if (label) out.push(`${label}（${role}）に直結`);
        continue;
      }
      const t = ENUM_ATTRS[k]?.[v];
      if (t) out.push(t);
    }
  }
  return out;
}

export function mitigationLabel(labels: LabelsFile | undefined, id: string): string {
  return labels?.mitigations[id] ?? labels?.custom[id]?.labelJa ?? id;
}

/**
 * カルテ → 抽象化カルテ。役割ごとに 1 件（同じ役割の資産が複数なら属性と緩和策を合算する）
 */
export function abstractProfile(
  profile: CompanyProfile,
  graph: Graph,
  roles: RoleDef[],
  options: { labels?: LabelsFile; goals?: string[] } = {},
): AbstractedProfile {
  const roleDef = (role: string) => roles.find((r) => r.id === role);
  const roleLabel = (role: string) => roleDef(role)?.labelJa;
  const assetRole = (assetId: string) => profile.assets.find((a) => a.id === assetId)?.role;
  const nodeRole = new Map(graph.nodes.map((n) => [n.id, n.role]));

  const byRole = new Map<string, AbstractedRole>();
  const order: string[] = [];
  const ensure = (role: string, side: AbstractedRole["side"]): AbstractedRole => {
    let r = byRole.get(role);
    if (!r) {
      r = {
        role,
        labelJa: roleLabel(role) ?? role,
        side,
        connectsTo: [],
        attrsJa: [],
        controls: [],
      };
      byRole.set(role, r);
      order.push(role);
    }
    return r;
  };

  ensure("attacker", "社外");
  for (const a of profile.assets) {
    const def = roleDef(a.role);
    const side = SIDE_JA[a.side ?? def?.side ?? "internal"];
    const r = ensure(a.role, side);
    for (const t of attrsOf(a.attrs, roleLabel, assetRole))
      if (!r.attrsJa.includes(t)) r.attrsJa.push(t);
    for (const c of a.controls) {
      const existing = r.controls.find((x) => x.mitigation === c.mitigation);
      const status = STATUS_JA[c.status];
      if (!existing) {
        r.controls.push({
          mitigation: c.mitigation,
          labelJa: mitigationLabel(options.labels, c.mitigation),
          status,
        });
      } else if (existing.status === "未確認" && status !== "未確認") {
        existing.status = status;
      }
    }
  }

  for (const e of graph.edges) {
    if (e.kind !== "network") continue;
    const r1 = nodeRole.get(e.from);
    const r2 = nodeRole.get(e.to);
    if (!r1 || !r2 || r1 === r2) continue;
    const a = byRole.get(r1);
    const b = byRole.get(r2);
    if (!a || !b) continue;
    if (!a.connectsTo.includes(r2)) a.connectsTo.push(r2);
    if (!b.connectsTo.includes(r1)) b.connectsTo.push(r1);
  }
  // 攻撃者は常に先頭
  const attackerRole = nodeRole.get(ATTACKER_NODE_ID) ?? "attacker";
  const sorted = order.sort((x, y) =>
    x === attackerRole ? -1 : y === attackerRole ? 1 : order.indexOf(x) - order.indexOf(y),
  );
  return {
    pattern: profile.pattern,
    roles: sorted.map((r) => byRole.get(r) as AbstractedRole),
    goals: options.goals ?? ["core"],
  };
}

/** 抽象化カルテを Claude に渡す文章にする */
export function renderAbstracted(p: AbstractedProfile): string {
  const lines: string[] = [
    "<profile>",
    `構成パターン：${p.pattern}。役割の枠だけで表し、製品名・社名・ホスト名は含まない。`,
    `目標の役割：${p.goals.join("、")}`,
    "",
  ];
  for (const r of p.roles) {
    lines.push(`## ${r.role}（${r.labelJa}、${r.side}）`);
    if (r.connectsTo.length > 0) lines.push(`- つながる役割：${r.connectsTo.join("、")}`);
    if (r.attrsJa.length > 0) lines.push(`- 属性：${r.attrsJa.join("、")}`);
    if (r.controls.length > 0)
      lines.push(
        `- 対策：${r.controls.map((c) => `${c.labelJa}（${c.mitigation}）＝${c.status}`).join("、")}`,
      );
    lines.push("");
  }
  lines.push("</profile>");
  return lines.join("\n");
}

/**
 * 抽象化カルテに固有名詞が混ざっていないか（テストと記録時の自己点検）。
 * カルテに載っている製品名・バージョン・社名・ドメイン・ホスト名・資産 ID・CVE が
 * 描画した文章に現れたら、その語を返す
 */
export function leakedTerms(profile: CompanyProfile, rendered: string): string[] {
  const terms = new Set<string>();
  const add = (v: unknown) => {
    if (typeof v === "string" && v.trim().length >= 3) terms.add(v.trim());
  };
  add(profile.companyName);
  add(profile.domain);
  add(profile.vendor?.name);
  add(profile.vendor?.email);
  const roleIds = new Set(profile.assets.map((a) => a.role));
  for (const a of profile.assets) {
    add(a.product);
    add(a.version);
    if (!roleIds.has(a.id) && !/^[a-z]+$/.test(a.id)) add(a.id);
    for (const [k, v] of Object.entries(a.attrs)) {
      if (typeof v === "string" && !(k in ENUM_ATTRS) && k !== "connectsTo") add(v);
    }
    for (const c of a.controls) add(c.noteJa);
  }
  for (const b of profile.businesses) add(b.name);
  for (const p of profile.personalData) add(p.descriptionJa);
  const leaked = [...terms].filter((t) => rendered.includes(t));
  if (/CVE-\d{4}-\d+/i.test(rendered)) leaked.push("CVE");
  if (/[\w.+-]+@[\w-]+\.[\w.-]+/.test(rendered)) leaked.push("メールアドレス");
  return leaked;
}
