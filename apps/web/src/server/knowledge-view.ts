/**
 * 画面に渡す知識：questions.yaml を画面向けの形に整える（判定には使わない）
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { knowledgeDir } from "@uchidai/engine";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import type { Question } from "../shared/api.ts";

const Option = z.looseObject({ value: z.string(), labelJa: z.string() });
const QuestionYaml = z.looseObject({
  id: z.string(),
  textJa: z.string(),
  hintJa: z.string().optional(),
  multi: z.boolean().optional(),
  options: z.union([z.array(Option), z.array(z.string())]).optional(),
  optionLabelsJa: z.record(z.string(), z.string()).optional(),
  rows: z.array(z.looseObject({ key: z.string(), labelJa: z.string() })).optional(),
});
const File = z.object({ questions: z.array(QuestionYaml) });

let cached: Question[] | undefined;
export function loadQuestions(): Question[] {
  if (cached) return cached;
  const raw = File.parse(parseYaml(readFileSync(join(knowledgeDir, "questions.yaml"), "utf8")));
  cached = raw.questions.map((q): Question => {
    if (q.id === "hosting") {
      const keys = (q.options ?? []) as string[];
      return {
        id: "hosting",
        textJa: q.textJa,
        ...(q.hintJa ? { hintJa: q.hintJa } : {}),
        multi: false,
        rows: (q.rows ?? []).map((r) => ({
          key: r.key as "mail" | "files" | "core" | "web",
          labelJa: r.labelJa,
        })),
        options: keys.map((k) => ({ value: k, labelJa: q.optionLabelsJa?.[k] ?? k })),
      };
    }
    const opts = (q.options ?? []) as { value: string; labelJa: string }[];
    return {
      id: q.id as "industry" | "site" | "remoteAccess" | "backup",
      textJa: q.textJa,
      ...(q.hintJa ? { hintJa: q.hintJa } : {}),
      multi: q.multi === true,
      options: opts.map((o) => ({ value: o.value, labelJa: o.labelJa })),
    };
  });
  return cached;
}
