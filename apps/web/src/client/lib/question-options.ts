/**
 * 最初の5問の選択肢を、先に答えた業種に合わせて絞る。
 * 選択肢に industries があれば、その業種のときだけ出す（製造業に「診療所・病院」は出さない）。
 * 業種がまだ決まっていない、または絞った結果が空になるときは、絞らずにすべて出す
 */
import type { QuestionOption } from "../../shared/api.ts";

export function optionsForIndustry(
  options: QuestionOption[],
  industry: string | undefined,
): QuestionOption[] {
  if (!industry) return options;
  const shown = options.filter((o) => !o.industries || o.industries.includes(industry));
  return shown.length > 0 ? shown : options;
}
