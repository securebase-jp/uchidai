/**
 * デモ場面 9 用：デモ精工 × 事例 1 の「社長向けの一枚」を、Claude の言い換えつきで一度だけ作り、
 * demo/recordings/onepager.demo-seiko.ipa-case-1.json に記録する。デモモードの画面はこの記録を即座に使う
 * （API も Claude も呼ばない。毎回同じ映像になり、言い換えを待つ約 3 秒の骨組みも出ない）。
 *
 * POST /api/onepager と同じ経路（app.request、in-process）を呼ぶ。状態は場面 9 と同じにそろえる：
 * 対策なし、場面 5 のベンダー回答（返信の番号 1 ＝ 管理者のパスワードは全 PC で共通）を入れた状態。
 * Claude の API キーはサーバ側の環境変数から読まれる（このスクリプトは値を読まず、出力もしない）。
 * 言い換えたのが Claude でなければ（キーが無い・検証で捨てた・失敗した）、何も書かずに止まる。リクエストヘッダは保存しない。
 *
 * 実行（キーのある環境変数ファイルを Node に渡す。api.anthropic.com への通信が要る）：
 *   node --disable-warning=ExperimentalWarning --env-file=<.env のパス> demo/scripts/record-onepager.ts
 * 記録が今の判定・一枚の文（engine とカルテ）と合っているかだけを確かめる（Claude を呼ばない。合わなければ終了コード 1）：
 *   node --disable-warning=ExperimentalWarning demo/scripts/record-onepager.ts --check
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app } from "../../apps/web/src/server/app.ts";
import {
  ONEPAGER_RECORDING_NOTE,
  ONEPAGER_RECORDING_VERSION,
  OnePagerRecording,
} from "../../apps/web/src/shared/onepagerRecording.ts";
import {
  answerFromReply,
  findSecretLike,
  parseVendorRequestRecording,
} from "../../apps/web/src/shared/vendorRequestRecording.ts";
import { repoRoot } from "./lib.ts";

const PROFILE_ID = "demo-seiko";
const CASE_ID = "ipa-case-1";
export const ONEPAGER_RECORDING_PATH = join(
  repoRoot,
  "demo",
  "recordings",
  `onepager.${PROFILE_ID}.${CASE_ID}.json`,
);
const VENDOR_PATH = join(repoRoot, "demo", "recordings", `vendor-request.${PROFILE_ID}.json`);
/** 場面 5 の操作と同じ：返信の番号 1、入力した人「山田」 */
const REPLY = { choiceIndex: 0, repliedBy: "山田", enteredBy: "山田" };

function stop(message: string, code = 2): never {
  console.error(`止めました：${message}`);
  process.exit(code);
}

// biome-ignore lint/suspicious/noExplicitAny: 応答の形は記録のスキーマで確かめる
async function json(res: Response | Promise<Response>): Promise<any> {
  const r = await res;
  if (!r.ok) stop(`${r.url || "API"} が ${r.status}`);
  return r.json();
}

async function recordedCase() {
  return (await json(app.request(`/api/case/recorded/${CASE_ID}`))).case;
}

async function onepager(rewrite: boolean, answers: unknown[]) {
  const c = { case: await recordedCase() };
  const p = await json(app.request(`/api/examples/${PROFILE_ID}`));
  return json(
    app.request("/api/onepager", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ case: c.case, profile: p.profile, measureIds: [], answers, rewrite }),
    }),
  );
}

/** 判定と一枚のうち、Claude が書かない部分（「何が起きるか」の文と、文の出所を除いたもの） */
// biome-ignore lint/suspicious/noExplicitAny: 比べるだけ
function deterministic(r: any): string {
  const { whatHappensJa: _w, ...op } = r.onePager;
  return JSON.stringify({ ...r, onePager: op, text: undefined });
}

if (process.argv.includes("--check")) {
  if (!existsSync(ONEPAGER_RECORDING_PATH)) stop(`記録 ${ONEPAGER_RECORDING_PATH} がありません`, 1);
  const rec = OnePagerRecording.parse(JSON.parse(readFileSync(ONEPAGER_RECORDING_PATH, "utf8")));
  const now = await onepager(false, rec.answers);
  if (deterministic(now) !== deterministic(rec.response))
    stop(
      "記録の一枚（判定・数字・期限・対策）が、今の engine とカルテの出力と違います。11/7 の手順で記録を作り直してください（demo/README.md）",
      1,
    );
  console.log(
    `記録は今の判定と一致しています（${rec.recordedAt}、${rec.model}、「何が起きるか」${rec.response.onePager.whatHappensJa.length} 行）`,
  );
  process.exit(0);
}

const vendor = parseVendorRequestRecording(JSON.parse(readFileSync(VENDOR_PATH, "utf8")));
const choice = vendor.choiceMap[REPLY.choiceIndex];
if (!choice) stop("ベンダー確認の記録に返信の番号 1 がありません");
const recordedAt = new Date().toISOString();
const answer = answerFromReply(vendor, {
  choice: choice.id,
  repliedBy: REPLY.repliedBy,
  receivedAt: recordedAt,
  enteredBy: REPLY.enteredBy,
});
if (!answer) stop("ベンダー回答を組み立てられませんでした");

const response = await onepager(true, [answer]);
if (response.text?.source !== "claude")
  stop(
    `「何が起きるか」の文を書いたのが Claude ではありません（${response.text?.noteJa ?? response.text?.source}）。キーと通信を確かめてください`,
  );

const recording = OnePagerRecording.parse({
  version: ONEPAGER_RECORDING_VERSION,
  note: ONEPAGER_RECORDING_NOTE,
  recordedAt,
  model: response.text.model ?? "claude",
  profileId: PROFILE_ID,
  caseId: CASE_ID,
  measureIds: [],
  answers: [answer],
  entryUnknown: (await recordedCase()).clarity === "unknown",
  response,
});
const out = `${JSON.stringify(recording, null, 2)}\n`;
const secrets = findSecretLike(out);
if (secrets.length > 0) stop(`記録に ${secrets.join("、")} らしき文字列があります。書き出しません`);
mkdirSync(join(repoRoot, "demo", "recordings"), { recursive: true });
writeFileSync(ONEPAGER_RECORDING_PATH, out);
console.log(`書き出しました：${ONEPAGER_RECORDING_PATH}（${recording.model}）`);
for (const line of recording.response.onePager.whatHappensJa) console.log(`  ・${line}`);
