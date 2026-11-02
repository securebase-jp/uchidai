/**
 * MITRE ATT&CK Enterprise の STIX バンドルから、ウチダイが使う部分だけを抽出する。
 *
 *   node scripts/import-attack.ts <STIX の URL またはファイル>
 *   既定：attack-stix-data の index.json から最新の Enterprise を取得
 *
 * 出力：knowledge/attack/enterprise.json、knowledge/attack/version.json
 * 規約：NOTICE を参照（© The MITRE Corporation）
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const INDEX_URL =
  "https://raw.githubusercontent.com/mitre-attack/attack-stix-data/master/index.json";
const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "knowledge", "attack");

type Stix = {
  type: string;
  id: string;
  name?: string;
  revoked?: boolean;
  x_mitre_deprecated?: boolean;
  x_mitre_version?: string;
  x_mitre_shortname?: string;
  modified?: string;
  external_references?: { source_name: string; external_id?: string }[];
  kill_chain_phases?: { kill_chain_name: string; phase_name: string }[];
  relationship_type?: string;
  source_ref?: string;
  target_ref?: string;
};

async function load(src: string | undefined): Promise<{ objects: Stix[] }> {
  if (src && !src.startsWith("http")) return JSON.parse(readFileSync(src, "utf8"));
  let url = src;
  if (!url) {
    const index = (await (await fetch(INDEX_URL)).json()) as {
      collections: { name: string; versions: { url: string }[] }[];
    };
    const ent = index.collections.find((c) => c.name === "Enterprise ATT&CK");
    if (!ent?.versions[0]) throw new Error("Enterprise ATT&CK が index.json に見つかりません");
    url = ent.versions[0].url;
  }
  console.log(`取得: ${url}`);
  return (await (await fetch(url)).json()) as { objects: Stix[] };
}

function attackId(o: Stix): string | undefined {
  return o.external_references?.find((r) => r.source_name === "mitre-attack")?.external_id;
}

const bundle = await load(process.argv[2]);
const objects = bundle.objects;
const collection = objects.find((o) => o.type === "x-mitre-collection");
const version = collection?.x_mitre_version ?? "unknown";
const modified = collection?.modified ?? "";

const tactics = objects
  .filter((o) => o.type === "x-mitre-tactic")
  .map((o) => ({ id: attackId(o) ?? "", name: o.name ?? "", shortname: o.x_mitre_shortname ?? "" }))
  .filter((t) => t.id.startsWith("TA"))
  .sort((a, b) => a.id.localeCompare(b.id));
const shortToId = new Map(tactics.map((t) => [t.shortname, t.id]));

const stixToAttack = new Map<string, string>();
for (const o of objects) {
  const id = attackId(o);
  if (id && (o.type === "attack-pattern" || o.type === "course-of-action"))
    stixToAttack.set(o.id, id);
}

const techniques = objects
  .filter((o) => o.type === "attack-pattern")
  .map((o) => {
    const id = attackId(o) ?? "";
    return {
      id,
      name: o.name ?? "",
      tactics: (o.kill_chain_phases ?? [])
        .filter((p) => p.kill_chain_name === "mitre-attack")
        .map((p) => shortToId.get(p.phase_name) ?? "")
        .filter((t) => t !== ""),
      ...(id.includes(".") ? { parent: id.split(".")[0] } : {}),
      revoked: o.revoked === true,
      deprecated: o.x_mitre_deprecated === true,
    };
  })
  .filter((t) => /^T\d{4}(\.\d{3})?$/.test(t.id))
  .sort((a, b) => a.id.localeCompare(b.id));

const mitigations = objects
  .filter((o) => o.type === "course-of-action")
  .map((o) => ({
    id: attackId(o) ?? "",
    name: o.name ?? "",
    deprecated: o.x_mitre_deprecated === true,
  }))
  .filter((m) => /^M\d{4}$/.test(m.id))
  .sort((a, b) => a.id.localeCompare(b.id));

const mitigates = objects
  .filter(
    (o) => o.type === "relationship" && o.relationship_type === "mitigates" && o.revoked !== true,
  )
  .map((o) => [stixToAttack.get(o.source_ref ?? ""), stixToAttack.get(o.target_ref ?? "")])
  .filter((p): p is [string, string] => !!p[0] && !!p[1] && /^M\d{4}$/.test(p[0]))
  .sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));

/** 廃止（revoked）された手法 → 置き換え先。v20 で T1656 → T1684.001 など */
const revokedBy = objects
  .filter((o) => o.type === "relationship" && o.relationship_type === "revoked-by")
  .map((o) => [stixToAttack.get(o.source_ref ?? ""), stixToAttack.get(o.target_ref ?? "")])
  .filter((p): p is [string, string] => !!p[0] && !!p[1] && /^T\d{4}/.test(p[0]))
  .sort((a, b) => a[0].localeCompare(b[0]));

mkdirSync(outDir, { recursive: true });
writeFileSync(
  join(outDir, "enterprise.json"),
  `${JSON.stringify({ version, modified, tactics, techniques, mitigations, mitigates, revokedBy })}\n`,
);
writeFileSync(
  join(outDir, "version.json"),
  `${JSON.stringify(
    {
      domain: "enterprise-attack",
      version,
      modified,
      importedAt: new Date().toISOString(),
      source: "https://github.com/mitre-attack/attack-stix-data",
      notice:
        "© 2026 The MITRE Corporation. This work is reproduced and distributed with the permission of The MITRE Corporation. See NOTICE.",
    },
    null,
    2,
  )}\n`,
);
console.log(
  `ATT&CK Enterprise v${version}: 戦術 ${tactics.length}、手法 ${techniques.length}、緩和策 ${mitigations.length}、緩和関係 ${mitigates.length}、廃止→置換 ${revokedBy.length}`,
);
