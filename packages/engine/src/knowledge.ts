/**
 * 知識ファイル（knowledge/）と会社カルテ（examples/）の読み込みと検証
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import {
  AttackData,
  CompanyProfile,
  Layer,
  MitigationId,
  Role,
  Side,
  TacticId,
  TechniqueId,
} from "./types.ts";

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const knowledgeDir = join(repoRoot, "knowledge");

export const RoleDef = z.object({
  id: Role,
  labelJa: z.string(),
  layer: Layer,
  side: Side,
  descriptionJa: z.string().optional(),
});
export const RolesFile = z.object({ roles: z.array(RoleDef) });

export const LabelsFile = z.object({
  tactics: z.record(TacticId, z.string()),
  techniques: z.record(TechniqueId, z.string()),
  mitigations: z.record(z.string().regex(/^M\d{4}$/), z.string()),
  custom: z.record(
    z.string().regex(/^UD-\d{2}$/),
    z.object({ labelJa: z.string(), descriptionJa: z.string().optional() }),
  ),
});
export type RoleDef = z.infer<typeof RoleDef>;
export type LabelsFile = z.infer<typeof LabelsFile>;

function readYaml(rel: string): unknown {
  return parseYaml(readFileSync(join(knowledgeDir, rel), "utf8"));
}

export function loadAttack(): AttackData {
  return AttackData.parse(
    JSON.parse(readFileSync(join(knowledgeDir, "attack/enterprise.json"), "utf8")),
  );
}
export function loadRoles(): RoleDef[] {
  return RolesFile.parse(readYaml("roles.yaml")).roles;
}
export function loadLabels(): LabelsFile {
  return LabelsFile.parse(readYaml("labels.ja.yaml"));
}
export function loadProfile(path: string): CompanyProfile {
  return CompanyProfile.parse(JSON.parse(readFileSync(path, "utf8")));
}

/** 役割が登録済みか。business.* は動的に許す */
export function isKnownRole(role: string, roles: RoleDef[]): boolean {
  return role.startsWith("business") || roles.some((r) => r.id === role);
}

/** 廃止された手法 ID を置き換え先に正規化する（存在しなければ undefined） */
export function canonicalTechnique(id: string, attack: AttackData): string | undefined {
  const replaced = attack.revokedBy.find(([old]) => old === id)?.[1];
  const target = replaced ?? id;
  const t = attack.techniques.find((x) => x.id === target);
  return t && !t.revoked ? t.id : undefined;
}

/** 知識ファイルと会社カルテの整合性を検証し、問題の一覧を返す */
export function checkKnowledge(profilePaths: string[]): string[] {
  const problems: string[] = [];
  const attack = loadAttack();
  const roles = loadRoles();
  const labels = loadLabels();

  const techniqueIds = new Set(attack.techniques.map((t) => t.id));
  const tacticIds = new Set(attack.tactics.map((t) => t.id));
  const mitigationIds = new Set(attack.mitigations.map((m) => m.id));

  for (const id of Object.keys(labels.tactics))
    if (!tacticIds.has(id)) problems.push(`labels: 戦術 ${id} は ATT&CK v${attack.version} にない`);
  for (const id of tacticIds)
    if (!labels.tactics[id]) problems.push(`labels: 戦術 ${id} の日本語ラベルがない`);
  for (const id of Object.keys(labels.techniques))
    if (!techniqueIds.has(id))
      problems.push(`labels: 手法 ${id} は ATT&CK v${attack.version} にない`);
  for (const id of Object.keys(labels.mitigations))
    if (!mitigationIds.has(id))
      problems.push(`labels: 緩和策 ${id} は ATT&CK v${attack.version} にない`);

  const dup = roles.map((r) => r.id).filter((id, i, a) => a.indexOf(id) !== i);
  for (const id of dup) problems.push(`roles: ${id} が重複`);

  for (const path of profilePaths) {
    let profile: CompanyProfile;
    try {
      profile = loadProfile(path);
    } catch (e) {
      problems.push(`${path}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    const assetIds = new Set(profile.assets.map((a) => a.id));
    for (const a of profile.assets) {
      if (!isKnownRole(a.role, roles))
        problems.push(`${path}: 資産 ${a.id} の役割 ${a.role} は roles.yaml にない`);
      for (const c of a.controls) {
        const known = c.mitigation.startsWith("UD-")
          ? c.mitigation in labels.custom
          : mitigationIds.has(c.mitigation);
        if (!known) problems.push(`${path}: 資産 ${a.id} の緩和策 ${c.mitigation} が未定義`);
        if (c.status === "unknown" && c.evidence !== "none")
          problems.push(`${path}: 資産 ${a.id} の ${c.mitigation} は未確認なのに根拠がある`);
        if (c.status !== "unknown" && c.evidence === "none")
          problems.push(
            `${path}: 資産 ${a.id} の ${c.mitigation} は根拠なしで ${c.status} になっている`,
          );
      }
    }
    for (const b of profile.businesses)
      for (const id of b.assetIds)
        if (!assetIds.has(id)) problems.push(`${path}: 業務 ${b.id} が存在しない資産 ${id} を参照`);
    for (const p of profile.personalData)
      if (!assetIds.has(p.assetId))
        problems.push(`${path}: 個人情報が存在しない資産 ${p.assetId} を参照`);
  }
  return problems;
}

/** knowledge/schemas/ に JSON Schema を書き出すための一覧 */
export const schemaExports = {
  "roles.schema.json": RolesFile,
  "labels.schema.json": LabelsFile,
  "company-profile.schema.json": CompanyProfile,
  "attack.schema.json": AttackData,
  "mitigation-id.schema.json": MitigationId,
} as const;
