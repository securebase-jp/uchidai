/**
 * デモ場面 5 用：管理者アカウント（M1026）のベンダー確認依頼を、Claude で一度だけ実際に生成して
 * demo/recordings/vendor-request.demo-seiko.json に記録する。画面（デモモードの RequestSlot）はこの記録を使う
 * （サーバにも送信箱にも依頼を作らず、Claude も呼ばない。毎回同じ映像になる）。
 *
 * POST /api/requests と同じ経路（requestRoutes）をその場で（in-process、一時ファイルの送信箱で）呼ぶ。
 * Claude の API キーはサーバ側の環境変数から読まれる（このスクリプトは値を読まず、出力もしない）。
 * 依頼文を書いたのが Claude でなければ（キーが無い・失敗して下書きになった）、何も書かずに止まる。
 * リクエストヘッダは保存しない。
 *
 * 実行（キーのある環境変数ファイルを Node に渡す。api.anthropic.com への通信が要る）：
 *   node --disable-warning=ExperimentalWarning --env-file=<.env のパス> demo/scripts/record-vendor-request.ts
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OutboxMailer } from "../../apps/web/src/server/mail/mailer.ts";
import { questionFor } from "../../apps/web/src/server/requests/questions.ts";
import { requestRoutes } from "../../apps/web/src/server/routes/requests.ts";
import { RequestStore } from "../../apps/web/src/server/store/requests.ts";
import type { RequestView } from "../../apps/web/src/shared/requests.ts";
import {
  findSecretLike,
  VENDOR_REQUEST_RECORDING_NOTE,
  VENDOR_REQUEST_RECORDING_VERSION,
  VendorRequestRecording,
} from "../../apps/web/src/shared/vendorRequestRecording.ts";
import { CompanyProfile } from "../../packages/engine/src/index.ts";
import { defaultModel } from "../../packages/llm/src/index.ts";
import { repoRoot } from "./lib.ts";

const PROFILE_PATH = join(repoRoot, "examples", "demo-seiko.json");
const OUT_PATH = join(repoRoot, "demo", "recordings", "vendor-request.demo-seiko.json");
const ASSET_ID = "admin";
const MITIGATION = "M1026";

function stop(message: string): never {
  console.error(`止めました：${message}`);
  process.exit(2);
}

const profile = CompanyProfile.parse(JSON.parse(readFileSync(PROFILE_PATH, "utf8")));
const asset = profile.assets.find((a) => a.id === ASSET_ID);
if (!asset) stop(`カルテに資産 ${ASSET_ID} がありません`);

const dir = mkdtempSync(join(tmpdir(), "uchidai-vendor-request-"));
try {
  const store = new RequestStore({ file: join(dir, "requests.json") });
  const app = requestRoutes({ store, mailer: new OutboxMailer() });
  const res = await app.request("/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      profile: {
        id: profile.id,
        companyName: profile.companyName,
        ...(profile.vendor ? { vendor: profile.vendor } : {}),
        assets: profile.assets.map((a) => ({ id: a.id, role: a.role, label: a.label })),
      },
      assetId: ASSET_ID,
      mitigation: MITIGATION,
      writer: "claude",
    }),
  });
  if (res.status !== 201) stop(`POST /api/requests が ${res.status}`);
  const body = (await res.json()) as { request: RequestView; writerNoteJa?: string };
  const view = body.request;
  if (view.writer !== "claude")
    stop(
      `依頼文を書いたのが Claude ではありません（${body.writerNoteJa ?? view.writer}）。キーと通信を確かめてください`,
    );
  const q = questionFor(MITIGATION, asset.role);
  if (!q) stop(`緩和策 ${MITIGATION} の質問がありません`);

  const recording = VendorRequestRecording.parse({
    version: VENDOR_REQUEST_RECORDING_VERSION,
    note: VENDOR_REQUEST_RECORDING_NOTE,
    recordedAt: new Date().toISOString(),
    model: defaultModel(),
    profileId: profile.id,
    assetId: view.assetId,
    mitigation: view.mitigation,
    writer: view.writer,
    subject: view.subject,
    text: view.text,
    mailtoUrl: view.mailtoUrl,
    ...(view.to ? { to: view.to } : {}),
    companyLabel: view.companyLabel,
    assetLabel: view.assetLabel,
    background: view.background,
    question: view.question,
    choiceMap: q.choices.map((c) => ({
      id: c.id,
      labelJa: c.labelJa,
      status: c.status,
      ...(c.attrs ? { attrs: c.attrs } : {}),
    })),
  });
  const json = `${JSON.stringify(recording, null, 2)}\n`;
  const secrets = findSecretLike(json);
  if (secrets.length > 0)
    stop(`記録に ${secrets.join("、")} らしき文字列があります。書き出しません`);
  mkdirSync(join(repoRoot, "demo", "recordings"), { recursive: true });
  writeFileSync(OUT_PATH, json);
  console.log(
    `書き出しました：${OUT_PATH}（件名：${recording.subject}、本文 ${recording.text.length} 字）`,
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}
