/**
 * デモモードだけで使う「社長向けの一枚」の記録（demo/recordings/onepager.demo-seiko.ipa-case-1.json）。
 * 会社・事例・対策・回答が記録と同じなら、API も Claude も呼ばずに記録の応答をそのまま返す。
 * デモでないとき、共有リンク（d=）、テンプレート文の指定（rewrite=0）、条件が違うときは undefined（いつもどおり API で作る）。
 * 記録の作り方と作り直しは demo/scripts/record-onepager.ts と demo/README.md。
 */
import recordingJson from "../../../../../demo/recordings/onepager.demo-seiko.ipa-case-1.json";
import type { AnswerInput } from "../../shared/api.ts";
import { matchesOnePagerRecording, OnePagerRecording } from "../../shared/onepagerRecording.ts";
import type { OnePagerResponse } from "../lib/api.ts";
import { isDemoMode } from "./params.ts";

let parsed: OnePagerRecording | null | undefined;
/** 記録（壊れていれば null。デモでないときは読まない） */
export function onePagerRecording(): OnePagerRecording | null {
  if (parsed === undefined) {
    const r = OnePagerRecording.safeParse(recordingJson);
    parsed = r.success ? r.data : null;
  }
  return parsed;
}

export type RecordedOnePager = {
  data: OnePagerResponse;
  entryUnknown: boolean;
  recordedAt: string;
  model: string;
};

export function recordedOnePagerForDemo(input: {
  profileId: string | undefined;
  caseId: string | undefined;
  measureIds: string[];
  answers: AnswerInput[];
  shared: string | undefined;
  rewrite: boolean;
}): RecordedOnePager | undefined {
  if (!isDemoMode() || input.shared || !input.rewrite) return undefined;
  const rec = onePagerRecording();
  if (!rec || !matchesOnePagerRecording(rec, input)) return undefined;
  return {
    // 記録のスキーマは応答の要所だけを確かめる（残りは POST /api/onepager の応答そのもの）
    data: rec.response as unknown as OnePagerResponse,
    entryUnknown: rec.entryUnknown,
    recordedAt: rec.recordedAt,
    model: rec.model,
  };
}
