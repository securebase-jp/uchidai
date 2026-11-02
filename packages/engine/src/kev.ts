/**
 * 悪用確認済み脆弱性（CISA KEV）との突き合わせ。
 *
 * - 担当者が自由入力した製品名と版を、knowledge/kev/products.yaml の別名表で製品に当て、
 *   KEV カタログ（vendorProject と product）から該当する CVE を拾い、版の範囲表で「該当／該当しない／未確認」を決める
 * - すべて純粋関数。Claude は使わない。ネットワークにも出ない（カタログは呼び出し側が渡す）
 * - 「該当しない」は「範囲を確認した CVE に限って該当しない」の意味。範囲が未確認の CVE は一覧で示す
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import type { Asset, CompanyProfile, Contradiction, EvidenceKind } from "./types.ts";

/** knowledge/kev/products.yaml の置き場（knowledge.ts と循環参照にならないよう、ここで別に求める） */
const kevKnowledgeDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "knowledge",
  "kev",
);

// ---------------------------------------------------------------------------
// KEV カタログ（CISA の JSON）
// ---------------------------------------------------------------------------
export const CveId = z.string().regex(/^CVE-\d{4}-\d{4,}$/);
export type CveId = z.infer<typeof CveId>;

export const KevEntry = z.looseObject({
  cveID: CveId,
  vendorProject: z.string(),
  product: z.string(),
  vulnerabilityName: z.string(),
  dateAdded: z.string(),
  shortDescription: z.string().default(""),
  requiredAction: z.string().default(""),
  dueDate: z.string().default(""),
  knownRansomwareCampaignUse: z.string().default("Unknown"),
  notes: z.string().default(""),
});
export const KevCatalog = z.looseObject({
  title: z.string(),
  catalogVersion: z.string(),
  dateReleased: z.string(),
  count: z.number().int().nonnegative(),
  vulnerabilities: z.array(KevEntry),
});
export type KevEntry = z.infer<typeof KevEntry>;
export type KevCatalog = z.infer<typeof KevCatalog>;

// ---------------------------------------------------------------------------
// 製品の対応表と版の範囲表（knowledge/kev/products.yaml）
// ---------------------------------------------------------------------------
export const VersionScheme = z.enum(["dotted", "r-release"]);
export const VersionRange = z
  .object({
    /** 下限（含む）。無ければ下限なし */
    from: z.string().min(1).optional(),
    /** 上限（含む） */
    to: z.string().min(1).optional(),
    /** 上限（含まない）。to と同時には書かない */
    below: z.string().min(1).optional(),
  })
  .refine((r) => !(r.to && r.below), { message: "to と below は同時に書かない" })
  .refine((r) => r.from || r.to || r.below, { message: "from / to / below のどれかが要る" });
export const KevRange = z.object({
  cve: CveId,
  /** 認証を経ずに悪用できる（多要素認証では止まらない）か。確認できないときは書かない */
  authBypass: z.boolean().optional(),
  kindJa: z.string(),
  affected: z.array(VersionRange).min(1),
  fixedJa: z.string(),
  sourceUrl: z.string().url(),
  checkedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  noteJa: z.string().optional(),
});
export const KevProduct = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  labelJa: z.string(),
  aliases: z.array(z.string().min(1)).min(1),
  kev: z.array(z.object({ vendorProject: z.string().min(1), productPattern: z.string().min(1) })),
  kevCves: z.array(CveId).default([]),
  versionScheme: VersionScheme.default("dotted"),
  versionHintJa: z.string().optional(),
  ranges: z.array(KevRange).default([]),
  unverified: z.array(z.object({ cve: CveId, noteJa: z.string() })).default([]),
});
export const KevProductsFile = z.object({
  checkedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  kevCatalogUrl: z.string().url(),
  products: z.array(KevProduct).min(1),
});
export type VersionScheme = z.infer<typeof VersionScheme>;
export type VersionRange = z.infer<typeof VersionRange>;
export type KevRange = z.infer<typeof KevRange>;
export type KevProduct = z.infer<typeof KevProduct>;
export type KevProductsFile = z.infer<typeof KevProductsFile>;

export function loadKevProducts(): KevProductsFile {
  return KevProductsFile.parse(
    parseYaml(readFileSync(join(kevKnowledgeDir, "products.yaml"), "utf8")),
  );
}

// ---------------------------------------------------------------------------
// 製品名の正規化と当てはめ
// ---------------------------------------------------------------------------
/** 表記ゆれを吸収する正規化：NFKC（全角英数→半角）、小文字、空白・ハイフン・アンダースコア・中黒を除く */
export function normalizeProductText(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\-_・/／()（）]/g, "");
}

/**
 * 自由入力の製品名を対応表の製品に当てる。別名（正規化後）が入力に含まれれば一致。
 * 複数の製品が一致するときは、一致した別名が最も長い製品を採る（「SonicWall SMA 100」は SonicOS ではなく SMA）
 */
export function matchProduct(
  input: string | undefined,
  table: KevProductsFile,
): KevProduct | undefined {
  if (!input) return undefined;
  const text = normalizeProductText(input);
  if (!text) return undefined;
  let best: { product: KevProduct; length: number } | undefined;
  for (const product of table.products) {
    for (const alias of product.aliases) {
      const a = normalizeProductText(alias);
      if (!a || !text.includes(a)) continue;
      if (!best || a.length > best.length) best = { product, length: a.length };
    }
  }
  return best?.product;
}

// ---------------------------------------------------------------------------
// 版の比較
// ---------------------------------------------------------------------------
type Token = number | string;

/** 「7.0.14」「14.1-43.56」「22.7R2.5」「6.5.4.14-109n」「R81.10」「11.12.4+541730」を数字と英字の並びに分ける */
export function tokenizeVersion(version: string): Token[] {
  const parts = version
    .normalize("NFKC")
    .toLowerCase()
    .match(/\d+|[a-z]+/g);
  return (parts ?? []).map((p) => (/^\d+$/.test(p) ? Number.parseInt(p, 10) : p));
}

/**
 * 版の比較。各位置を数値同士は数値で、英字同士は辞書順で比べる。
 * 片方が尽きたら、残りの先頭が英字なら長い方が新しい（10.2.9 < 10.2.9-h1、22.7R2 < 22.7R2.4）、数字でも長い方が新しい（7.0 < 7.0.1）。
 * 数値と英字が同じ位置に来たら英字を後（新しい）とみなす
 */
export function compareVersions(a: string, b: string): number {
  const ta = tokenizeVersion(a);
  const tb = tokenizeVersion(b);
  const n = Math.max(ta.length, tb.length);
  for (let i = 0; i < n; i++) {
    const x = ta[i];
    const y = tb[i];
    if (x === undefined && y === undefined) return 0;
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (typeof x === "number" && typeof y === "number") {
      if (x !== y) return x < y ? -1 : 1;
      continue;
    }
    if (typeof x === "string" && typeof y === "string") {
      if (x !== y) return x < y ? -1 : 1;
      continue;
    }
    return typeof x === "number" ? -1 : 1;
  }
  return 0;
}

/** 入力の文字列から版らしい部分を取り出す（「v7.0.14」「FortiOS 7.0.14 build0601」→ 7.0.14）。見つからなければ undefined */
export function extractVersion(
  input: string | undefined,
  scheme: VersionScheme,
): string | undefined {
  if (!input) return undefined;
  const text = input.normalize("NFKC").trim();
  if (!text) return undefined;
  if (scheme === "r-release") {
    const m = /\bR?(\d+(?:\.\d+)*)/i.exec(text);
    return m?.[1] ? `R${m[1]}` : undefined;
  }
  // 先頭の v / ver / version / Rev. を落とし、数字で始まる最初の塊（. - _ + と英数の続き）を取る
  const stripped = text.replace(/^(?:v(?:er(?:sion)?)?|rev)\.?\s*/i, "");
  const m = /\d+(?:[.\-_+][0-9a-z]+)*/i.exec(stripped);
  return m?.[0];
}

export function inRange(version: string, range: VersionRange): boolean {
  if (range.from && compareVersions(version, range.from) < 0) return false;
  if (range.to && compareVersions(version, range.to) > 0) return false;
  if (range.below && compareVersions(version, range.below) >= 0) return false;
  return true;
}

// ---------------------------------------------------------------------------
// 突き合わせ
// ---------------------------------------------------------------------------
export type KevVersionStatus = "affected" | "not_affected" | "unknown";

export type KevMatchedRange = {
  cve: CveId;
  authBypass?: boolean;
  kindJa: string;
  affectedJa: string;
  fixedJa: string;
  sourceUrl: string;
  checkedAt: string;
  noteJa?: string;
  /** KEV カタログの該当項目（カタログに無い CVE は undefined） */
  entry?: KevEntry;
};

export type KevMatch = {
  /** 対応表に当たった製品（当たらなければ undefined） */
  product?: { id: string; labelJa: string; versionScheme: VersionScheme; versionHintJa?: string };
  /** 入力から取り出した版 */
  version?: string;
  /** KEV カタログでこの製品に該当する CVE（新しい順） */
  entries: KevEntry[];
  versionStatus: KevVersionStatus;
  /** 版の範囲表で該当した CVE */
  matched: KevMatchedRange[];
  /** 範囲表で確認済みの CVE のうち該当しなかったもの */
  cleared: CveId[];
  /** KEV にあるが範囲表に無い（範囲は未確認）CVE */
  unverified: { cve: CveId; noteJa?: string }[];
  /** 判定の理由（日本語、1 文） */
  reasonJa: string;
  /** 出典（日本語の 1 行ずつ） */
  sourcesJa: string[];
  catalogVersion: string;
  dateReleased: string;
};

function rangeJa(r: VersionRange): string {
  if (r.from && r.to) return `${r.from}〜${r.to}`;
  if (r.from && r.below) return `${r.from} 以上 ${r.below} 未満`;
  if (r.from) return `${r.from} 以上`;
  if (r.to) return `${r.to} 以前`;
  if (r.below) return `${r.below} 未満`;
  return "";
}

/** KEV カタログからこの製品の CVE を拾う（新しい順） */
export function kevEntriesFor(product: KevProduct, catalog: KevCatalog): KevEntry[] {
  const extra = new Set(product.kevCves);
  const matchers = product.kev.map((k) => ({
    vendor: k.vendorProject.trim().toLowerCase(),
    re: new RegExp(k.productPattern, "i"),
  }));
  return catalog.vulnerabilities
    .filter(
      (v) =>
        extra.has(v.cveID) ||
        matchers.some(
          (m) => v.vendorProject.trim().toLowerCase() === m.vendor && m.re.test(v.product),
        ),
    )
    .sort((a, b) => (a.dateAdded < b.dateAdded ? 1 : a.dateAdded > b.dateAdded ? -1 : 0));
}

/**
 * 製品名と版を KEV と範囲表に突き合わせる。
 * - 製品が対応表に無い／版が読めない → unknown
 * - 版が範囲表のどれかに入る → affected
 * - 範囲表で確認した CVE のどれにも入らない → not_affected（範囲未確認の CVE は unverified に残す）
 * - ただし、版が範囲表のどの下限よりも古いときは unknown（表に無い古い脆弱性に当たっている可能性が高いため）
 */
export function matchKev(
  asset: Pick<Asset, "product" | "version">,
  catalog: KevCatalog,
  table: KevProductsFile,
): KevMatch {
  const base = {
    catalogVersion: catalog.catalogVersion,
    dateReleased: catalog.dateReleased,
  };
  const product = matchProduct(asset.product, table);
  if (!product) {
    return {
      ...base,
      entries: [],
      versionStatus: "unknown",
      matched: [],
      cleared: [],
      unverified: [],
      reasonJa: asset.product
        ? `製品名「${asset.product}」は対応表（knowledge/kev/products.yaml）のどの製品にも当たりません`
        : "製品名が未登録です",
      sourcesJa: [],
    };
  }
  const entries = kevEntriesFor(product, catalog);
  const productView = {
    id: product.id,
    labelJa: product.labelJa,
    versionScheme: product.versionScheme,
    ...(product.versionHintJa ? { versionHintJa: product.versionHintJa } : {}),
  };
  const rangeCves = new Set(product.ranges.map((r) => r.cve));
  const noteOf = new Map(product.unverified.map((u) => [u.cve, u.noteJa]));
  const unverified = entries
    .filter((e) => !rangeCves.has(e.cveID))
    .map((e) => {
      const noteJa = noteOf.get(e.cveID);
      return { cve: e.cveID, ...(noteJa ? { noteJa } : {}) };
    });
  const sourcesJa = [
    `CISA Known Exploited Vulnerabilities Catalog（カタログ版 ${catalog.catalogVersion}、公開 ${catalog.dateReleased.slice(0, 10)}）`,
    ...product.ranges.map((r) => `${r.cve} の版の範囲：${r.sourceUrl}（${r.checkedAt} 確認）`),
  ];
  const version = extractVersion(asset.version, product.versionScheme);
  const common = { ...base, product: productView, entries, unverified, sourcesJa };
  if (!version) {
    return {
      ...common,
      versionStatus: "unknown",
      matched: [],
      cleared: [],
      reasonJa: asset.version
        ? `版「${asset.version}」を読み取れません${product.versionHintJa ? `（${product.versionHintJa}）` : ""}`
        : "版が未登録のため、該当の有無を決められません（判定は黄のまま）",
    };
  }
  const entryOf = new Map(entries.map((e) => [e.cveID, e]));
  const matched: KevMatchedRange[] = [];
  const cleared: CveId[] = [];
  for (const r of product.ranges) {
    const hit = r.affected.filter((a) => inRange(version, a));
    if (hit.length === 0) {
      cleared.push(r.cve);
      continue;
    }
    const entry = entryOf.get(r.cve);
    matched.push({
      cve: r.cve,
      ...(r.authBypass !== undefined ? { authBypass: r.authBypass } : {}),
      kindJa: r.kindJa,
      affectedJa: r.affected.map(rangeJa).join("、"),
      fixedJa: r.fixedJa,
      sourceUrl: r.sourceUrl,
      checkedAt: r.checkedAt,
      ...(r.noteJa ? { noteJa: r.noteJa } : {}),
      ...(entry ? { entry } : {}),
    });
  }
  if (matched.length > 0) {
    return {
      ...common,
      version,
      versionStatus: "affected",
      matched,
      cleared,
      reasonJa: `${product.labelJa} ${version} は悪用確認済みの脆弱性 ${matched.map((m) => m.cve).join("、")} の影響を受ける版です`,
    };
  }
  if (product.ranges.length === 0) {
    return {
      ...common,
      version,
      versionStatus: "unknown",
      matched,
      cleared,
      reasonJa:
        entries.length === 0
          ? `${product.labelJa} に該当する項目は KEV カタログにありません（版の範囲表もありません）`
          : `${product.labelJa} の KEV の項目は ${entries.length} 件ありますが、版の範囲を確認できたものがないため、該当の有無を決められません`,
    };
  }
  // 範囲表のどの下限よりも古い版は、表に無い古い脆弱性に当たっている可能性が高いので「該当しない」にしない
  const lowerBounds = product.ranges.flatMap((r) => r.affected.map((a) => a.from));
  const hasOpenLower = lowerBounds.some((f) => f === undefined);
  const oldest = lowerBounds.filter((f): f is string => f !== undefined).sort(compareVersions)[0];
  if (!hasOpenLower && oldest && compareVersions(version, oldest) < 0) {
    return {
      ...common,
      version,
      versionStatus: "unknown",
      matched,
      cleared,
      reasonJa: `${version} は範囲表で確認した最も古い版（${oldest}）より古く、表に無い脆弱性に該当する可能性が高いため、該当の有無を決められません`,
    };
  }
  return {
    ...common,
    version,
    versionStatus: "not_affected",
    matched,
    cleared,
    reasonJa:
      unverified.length > 0
        ? `${version} は範囲を確認した ${cleared.length} 件（${cleared.join("、")}）には該当しません。KEV の他の ${unverified.length} 件は版の範囲が未確認です`
        : `${version} は範囲を確認した ${cleared.length} 件（${cleared.join("、")}）に該当しません`,
  };
}

// ---------------------------------------------------------------------------
// カルテへの反映（根拠は external = 公開情報）
// ---------------------------------------------------------------------------
/** KEV が書く属性のキー */
export const KEV_ATTR_KEYS = [
  "knownExploited",
  "authBypass",
  "kevCves",
  "kevCatalogVersion",
  "kevCheckedAt",
] as const;

export type ApplyKevResult = {
  profile: CompanyProfile;
  contradictions: Contradiction[];
  /** 書き換えた属性のキー */
  changed: string[];
};

const KEV_EVIDENCE: EvidenceKind = "external";

/**
 * 突き合わせの結果を資産の attrs に反映した新しいカルテを返す。
 * - affected：knownExploited = true、authBypass（範囲表に true があれば true、すべて false なら false、不明なら触らない）、kevCves、カタログ版、確認日時
 * - not_affected：knownExploited = false。前回の KEV 反映が書いた kevCves と authBypass（根拠 external）は消す
 * - unknown：何も変えない
 * 公開情報 ＞ ベンダー回答 ＞ 担当者登録 なので knownExploited は上書きし、食い違いは Contradiction として返す
 */
export function applyKev(
  profile: CompanyProfile,
  assetId: string,
  match: KevMatch,
  checkedAt = new Date().toISOString(),
): ApplyKevResult {
  const next: CompanyProfile = structuredClone(profile);
  const asset = next.assets.find((a) => a.id === assetId);
  if (!asset) throw new Error(`資産 ${assetId} がカルテにない`);
  const contradictions: Contradiction[] = [];
  const changed: string[] = [];
  if (match.versionStatus === "unknown") return { profile: next, contradictions, changed };

  const previous = asset.attrs.knownExploited;
  const previousEvidence = asset.attrEvidence.knownExploited;
  const wanted = match.versionStatus === "affected";
  if (
    typeof previous === "boolean" &&
    previous !== wanted &&
    previousEvidence !== undefined &&
    previousEvidence !== KEV_EVIDENCE &&
    previousEvidence !== "none"
  ) {
    const who = previousEvidence === "vendor" ? "ベンダー回答" : "担当者登録";
    const cves = match.matched.map((m) => m.cve).join("、");
    contradictions.push({
      assetId,
      messageJa: wanted
        ? `${asset.label} は${who}では悪用確認済みの脆弱性に「該当しない」とされていますが、公開情報（CISA KEV、${cves}）では該当します。公開情報で判定します`
        : `${asset.label} は${who}では悪用確認済みの脆弱性に「該当する」とされていますが、公開情報（CISA KEV の範囲表）では版 ${match.version ?? ""} は該当しません。公開情報で判定します`,
      external: wanted
        ? `公開情報：該当（${cves}）`
        : `公開情報：該当しない（版 ${match.version ?? ""}）`,
      registered: `${who}：${previous ? "該当" : "該当しない"}`,
    });
  }

  const set = (key: string, value: string | number | boolean) => {
    asset.attrs[key] = value;
    asset.attrEvidence[key] = KEV_EVIDENCE;
    changed.push(key);
  };
  const unsetIfKev = (key: string) => {
    if (asset.attrEvidence[key] !== KEV_EVIDENCE) return;
    delete asset.attrs[key];
    delete asset.attrEvidence[key];
    changed.push(key);
  };

  set("knownExploited", wanted);
  set("kevCatalogVersion", match.catalogVersion);
  set("kevCheckedAt", checkedAt);
  if (wanted) {
    set("kevCves", match.matched.map((m) => m.cve).join(","));
    const flags = match.matched.map((m) => m.authBypass);
    if (flags.some((f) => f === true)) set("authBypass", true);
    else if (flags.length > 0 && flags.every((f) => f === false)) set("authBypass", false);
  } else {
    unsetIfKev("kevCves");
    unsetIfKev("authBypass");
  }
  return { profile: next, contradictions, changed };
}
