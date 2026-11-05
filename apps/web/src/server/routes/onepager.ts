/**
 * 社長向けの一枚：POST /api/onepager {case, profile, measureIds, answers?, rewrite?}
 * → {onePager, graph, verdict, measures, profile, text}
 *
 * データは engine の buildOnePager（決定的）。「何が起きるか」の文だけ、キーがあれば Claude に言い換えさせる。
 * Claude には役割名と数値だけを渡し、出力は検証して、落ちればテンプレート文のまま返す。
 */
import {
  buildGraph,
  buildOnePager,
  Case,
  CompanyProfile,
  evaluate,
  loadKnowledge,
  type OnePager,
  thirdPartyLines,
} from "@uchidai/engine";
import { applyWriterOutput, writeOnePagerText, writerInputFrom } from "@uchidai/llm";
import { Hono } from "hono";
import { z } from "zod";
import { Answers, MeasureIds } from "../../shared/api.ts";
import { patchProfile } from "../profile-patch.ts";

export const OnePagerRequest = z.object({
  case: Case,
  profile: CompanyProfile,
  measureIds: MeasureIds,
  answers: Answers,
  /** Claude の言い換えを使うか（キーが無ければ常にテンプレート） */
  rewrite: z.boolean().default(true),
});
export type OnePagerTextSource = { source: "claude" | "template"; model?: string; noteJa?: string };

/** 言い換えの結果は同じ入力なら使い回す（サーバの寿命の間だけ） */
const cache = new Map<string, { text: string[]; model: string }>();
const WRITER_TIMEOUT_MS = 20_000;

async function rewrite(
  onePager: OnePager,
  verdict: Parameters<typeof writerInputFrom>[0],
  knowledge: Parameters<typeof writerInputFrom>[1],
): Promise<{ onePager: OnePager; text: OnePagerTextSource }> {
  const input = writerInputFrom(verdict, knowledge);
  const key = JSON.stringify(input);
  const hit = cache.get(key);
  if (hit)
    return {
      onePager: { ...onePager, whatHappensJa: [...hit.text, ...thirdPartyLines(verdict)] },
      text: { source: "claude", model: hit.model },
    };
  try {
    const result = await Promise.race([
      writeOnePagerText(input),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), WRITER_TIMEOUT_MS),
      ),
    ]);
    if (result.rejectedReason)
      return {
        onePager,
        text: {
          source: "template",
          noteJa: `Claude の文を検証で捨てました：${result.rejectedReason}`,
        },
      };
    cache.set(key, { text: result.value.whatHappensJa, model: result.model });
    // 第三者の事故のとき、御社が確認することと報告の案内は、言い換えに任せず、プログラムの文を後ろに付ける
    const applied = applyWriterOutput(onePager, result);
    return {
      onePager: {
        ...applied,
        whatHappensJa: [...applied.whatHappensJa, ...thirdPartyLines(verdict)],
      },
      text: { source: "claude", model: result.model },
    };
  } catch (e) {
    return {
      onePager,
      text: {
        source: "template",
        noteJa:
          // 呼べなかったのか、呼んだが応答が決められた形に合わなかったのかを区別して書く
          e instanceof Error && /スキーマ/.test(e.message)
            ? "Claude の応答が決められた形に合わなかったため、テンプレート文です"
            : `Claude を呼べなかったためテンプレート文です（${e instanceof Error ? e.message : String(e)}）`,
      },
    };
  }
}

export const onepagerRoutes = new Hono();

onepagerRoutes.post("/api/onepager", async (c) => {
  const body = OnePagerRequest.parse(await c.req.json());
  const k = loadKnowledge();
  const { profile, measures } = patchProfile(body.profile, body.measureIds, body.answers, k);
  const graph = buildGraph(profile, k.roles);
  const verdict = evaluate(body.case, profile, { knowledge: k, graph });
  const base = buildOnePager(verdict, profile, k, { caseTitle: body.case.title });
  const { onePager, text } =
    // 経路が無い（入口なし・対象外・カルテの範囲で入口が見つからない）ときは言い換える段階が無い。
    // Claude に任せると「入力には含まれていません」のような文になるので、エンジンの固定文のままにする
    body.rewrite && process.env.ANTHROPIC_API_KEY && verdict.paths.length > 0
      ? await rewrite(base, verdict, k)
      : {
          onePager: base,
          text: {
            source: "template" as const,
            ...(body.rewrite && verdict.paths.length > 0
              ? { noteJa: "API キーが無いためテンプレート文です" }
              : {}),
          },
        };
  return c.json({ onePager, graph, verdict, measures, profile, text });
});
