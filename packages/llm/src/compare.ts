/**
 * 知見なし比較：一般的な AI（知見ファイルなしの Claude）が挙げた対策を、
 * ウチダイの判定結果（経路の各段階の mitigations / ineffective）に照らして
 * 「この経路に効く／効かない（理由つき）／経路の外」に振り分ける。振り分けは engine の classifyMitigations（決定的）
 */

import type { Case } from "@uchidai/engine";
import { classifyMitigations, type LabelsFile, type Verdict } from "@uchidai/engine";
import type { GenericMitigation } from "./reader.ts";

export type ComparedMitigation = {
  /** 緩和策 ID（対応づけ不能のときは無い） */
  mitigation?: string;
  /** ウチダイの知識ファイルの日本語ラベル */
  labelJa?: string;
  /** 一般的な AI が付けた名前と理由 */
  nameJa: string;
  reasonJa: string;
  /** ウチダイの判定：効く／効かない段階と理由 */
  stageLabelJa?: string;
  verdictReasonJa?: string;
};

export type Comparison = {
  effective: ComparedMitigation[];
  ineffective: ComparedMitigation[];
  outside: ComparedMitigation[];
  /** 緩和策 ID が付かなかった、または存在しない ID だった対策（経路の外・対応づけ不能） */
  unmapped: ComparedMitigation[];
  counts: {
    total: number;
    effective: number;
    ineffective: number;
    outside: number;
    unmapped: number;
  };
};

export function compareGenericMitigations(
  items: GenericMitigation[],
  verdict: Verdict,
  labels?: LabelsFile,
): Comparison {
  const ids = items.map((i) => i.mitigationId).filter((x): x is string => x !== undefined);
  const cls = classifyMitigations(ids, verdict, labels);
  const byId = (id: string) => items.filter((i) => i.mitigationId === id);
  const rows = (
    list: { mitigation: string; labelJa: string; stageLabelJa?: string; reasonJa?: string }[],
  ): ComparedMitigation[] =>
    list.flatMap((m) =>
      byId(m.mitigation).map((i) => ({
        mitigation: m.mitigation,
        labelJa: m.labelJa,
        nameJa: i.nameJa,
        reasonJa: i.reasonJa,
        ...(m.stageLabelJa ? { stageLabelJa: m.stageLabelJa } : {}),
        ...(m.reasonJa ? { verdictReasonJa: m.reasonJa } : {}),
      })),
    );
  const effective = rows(cls.effective);
  const ineffective = rows(cls.ineffective);
  const outside = rows(cls.outside);
  const unmapped: ComparedMitigation[] = items
    .filter((i) => !i.mitigationId)
    .map((i) => ({ nameJa: i.nameJa, reasonJa: i.reasonJa }));
  return {
    effective,
    ineffective,
    outside,
    unmapped,
    counts: {
      total: items.length,
      effective: effective.length,
      ineffective: ineffective.length,
      outside: outside.length,
      unmapped: unmapped.length,
    },
  };
}

/**
 * 読解済みの事例（Case）を、知見なしの Claude に読ませる記事風の文章にする。
 * 記事の原文が手元に無いとき（画面から caseId でなく Case が来たとき）に使う
 */
export function caseAsArticle(c: Case): string {
  const lines = [c.title, ""];
  for (const s of c.steps) {
    if (s.quote) lines.push(s.quote);
    else if (s.summaryJa) lines.push(s.summaryJa);
  }
  return lines.join("\n");
}
