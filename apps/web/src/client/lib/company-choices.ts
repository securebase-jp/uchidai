/**
 * 上部バーの「会社」と「事例」の選択肢を組む純粋な関数。
 * 会社：このブラウザに保存した自社のカルテ（あるときだけ）と、架空の会社（GET /api/examples）。
 * 事例：先頭に「記事を貼る…」（その場で入力の吹き出しを開く）、区切りのあとに記録済みの事例（GET /api/case/recorded）。
 * 文字は最小限にする（会社名・業種・人数、被害の型・題名）
 */
import type { ExampleSummary } from "./api.ts";

export type CompanyChoice =
  | { kind: "own"; labelJa: string; companyName: string }
  | { kind: "example"; id: string; labelJa: string; companyName: string; fictional: boolean };

/** 架空の会社の一行：会社名（業種・人数） */
export function exampleLabelJa(e: ExampleSummary): string {
  const parts = [e.patternLabelJa, ...(e.employees !== undefined ? [`${e.employees} 名`] : [])];
  return `${e.companyName}（${parts.join("・")}）`;
}

export function companyChoices(
  own: { companyName: string } | undefined,
  examples: ExampleSummary[],
): CompanyChoice[] {
  const out: CompanyChoice[] = [];
  if (own)
    out.push({
      kind: "own",
      labelJa: `自社のカルテ（${own.companyName}）`,
      companyName: own.companyName,
    });
  for (const e of examples)
    out.push({
      kind: "example",
      id: e.id,
      labelJa: `${e.fictional ? "架空：" : ""}${exampleLabelJa(e)}`,
      companyName: e.companyName,
      fictional: e.fictional,
    });
  return out;
}

/** いま選んでいる会社に当たる選択肢か */
export function isCurrentCompany(
  choice: CompanyChoice,
  current: { id: string; source: "example" | "answers" | "saved" } | undefined,
): boolean {
  if (!current) return false;
  if (choice.kind === "own") return current.source !== "example";
  return current.source === "example" && current.id === choice.id;
}

export const DAMAGE_LABEL: Record<string, string> = {
  ransomware: "業務停止",
  bec: "なりすまし送金",
  data_breach: "情報漏えい",
  out_of_scope: "対象外",
};

export type CaseChoice =
  | { kind: "recorded"; id: string; labelJa: string; damageJa: string; title: string }
  | { kind: "article"; labelJa: string };

/** サーバに Claude API のキーが無いと、記事は読めない。そのことを「記事を貼る」の横に添える */
export const ARTICLE_LABEL = "記事を貼る…";
export const ARTICLE_KEY_NOTE = "（Claude API のキーが必要）";

/** 事例の選択肢：先頭が「記事を貼る…」、そのあとに記録済みの事例。readAvailable === false なら注記を添える */
export function caseChoices(
  recorded: { caseId: string; title: string; damageType: string }[],
  readAvailable?: boolean,
): CaseChoice[] {
  return [
    {
      kind: "article",
      labelJa: readAvailable === false ? `${ARTICLE_LABEL}${ARTICLE_KEY_NOTE}` : ARTICLE_LABEL,
    },
    ...recorded.map((r) => ({
      kind: "recorded" as const,
      id: r.caseId,
      damageJa: DAMAGE_LABEL[r.damageType] ?? r.damageType,
      title: r.title,
      labelJa: `${DAMAGE_LABEL[r.damageType] ?? r.damageType}　${r.title}`,
    })),
  ];
}
