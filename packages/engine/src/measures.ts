/**
 * 対策ボタンとベンダー回答の適用：会社カルテを書き換えて再判定できるようにする
 */
import type {
  Asset,
  CompanyProfile,
  Control,
  ControlPatch,
  ControlStatus,
  EvidenceKind,
  MitigationId,
} from "./types.ts";

function upsertControl(asset: Asset, control: Control): void {
  const i = asset.controls.findIndex((c) => c.mitigation === control.mitigation);
  if (i >= 0) asset.controls[i] = control;
  else asset.controls.push(control);
}

/** 対策を適用した新しいカルテを返す（元のカルテは変えない）。根拠は担当者登録 */
export function applyMeasures(
  profile: CompanyProfile,
  measures: { id?: string; labelJa?: string; patches: ControlPatch[] }[],
  appliedAt = new Date().toISOString(),
): CompanyProfile {
  const next: CompanyProfile = structuredClone(profile);
  for (const m of measures) {
    for (const p of m.patches) {
      for (const asset of next.assets.filter((a) => a.role === p.role)) {
        upsertControl(asset, {
          mitigation: p.mitigation,
          status: p.status,
          evidence: "registered",
          noteJa: `対策「${m.labelJa ?? m.id ?? p.mitigation}」を適用（想定）`,
          answeredBy: "担当者（対策ボタン）",
          answeredAt: appliedAt,
        });
        for (const [k, v] of Object.entries(p.attrs ?? {})) {
          asset.attrs[k] = v;
          asset.attrEvidence[k] = "registered";
        }
      }
    }
  }
  return next;
}

/** ベンダーなどからの回答で、資産の緩和策の状態を更新した新しいカルテを返す */
export function applyAnswer(
  profile: CompanyProfile,
  answer: {
    assetId: string;
    mitigation: MitigationId;
    status: ControlStatus;
    evidence: EvidenceKind;
    answeredBy: string;
    answeredAt?: string;
    noteJa?: string;
    attrs?: Record<string, string | number | boolean>;
  },
): CompanyProfile {
  const next: CompanyProfile = structuredClone(profile);
  const asset = next.assets.find((a) => a.id === answer.assetId);
  if (!asset) throw new Error(`資産 ${answer.assetId} がカルテにない`);
  upsertControl(asset, {
    mitigation: answer.mitigation,
    status: answer.status,
    evidence: answer.status === "unknown" ? "none" : answer.evidence,
    ...(answer.noteJa ? { noteJa: answer.noteJa } : {}),
    answeredBy: answer.answeredBy,
    answeredAt: answer.answeredAt ?? new Date().toISOString(),
  });
  for (const [k, v] of Object.entries(answer.attrs ?? {})) {
    asset.attrs[k] = v;
    asset.attrEvidence[k] = answer.evidence;
  }
  return next;
}

/** 未確認の緩和策（確認依頼の候補）を列挙する */
export function pendingControls(
  profile: CompanyProfile,
): { assetId: string; label: string; mitigation: MitigationId; noteJa?: string }[] {
  return profile.assets.flatMap((a) =>
    a.controls
      .filter((c) => c.status === "unknown")
      .map((c) => ({
        assetId: a.id,
        label: a.label,
        mitigation: c.mitigation,
        ...(c.noteJa ? { noteJa: c.noteJa } : {}),
      })),
  );
}
