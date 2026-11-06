/**
 * ポータブル ZIP の起動処理（同梱の Node で動く。依存なしの単独のファイル）。
 *
 * ウチダイを起動.bat / ウチダイを起動.command / start.sh から呼ばれ、次のことをする。
 *   1. uchidai.env（任意）を読む。環境変数が先で、ファイルは足りないものだけ補う
 *   2. 手元（127.0.0.1）だけで待ち受けるよう固定し、保存先をユーザー領域にする
 *   3. 空いているポートを選び、サーバ（apps/web/src/server/index.ts）を別プロセスで起動する
 *   4. 応答（/api/health）を待ち、既定のブラウザで画面を開く
 *   5. 終了（ウィンドウを閉じる、Ctrl+C）でサーバも止める
 *
 * UCHIDAI_NO_BROWSER=1 でブラウザを開かない（動作確認用）。
 * このファイルは ZIP の runtime/ に置かれ、配布物のルートは 1 つ上のフォルダ。
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_PORT,
  defaultDataDir,
  findFreePort,
  isUchidaiRunning,
  mergeEnv,
  openCommand,
  PORT_TRIES,
  parseEnvFile,
  parsePort,
} from "./launcher-lib.mjs";

const HOST = "127.0.0.1";

const alive = (child) => child.exitCode === null && child.signalCode === null;

/** 応答が 2 回続けて返り、その間もこの子プロセスが生きているときだけ「準備できた」とする（別のウチダイの応答と取り違えない） */
async function waitForHealth(port, child, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let successes = 0;
  while (Date.now() < deadline) {
    if (!alive(child)) return false;
    successes = (await isUchidaiRunning(port)) && alive(child) ? successes + 1 : 0;
    if (successes >= 2) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

function openBrowser(url) {
  const { command, args } = openCommand(process.platform, url);
  try {
    const opener = spawn(command, args, {
      stdio: "ignore",
      detached: true,
      windowsVerbatimArguments: true,
    });
    opener.on("error", () =>
      console.log(
        `ブラウザを自動で開けませんでした。次のアドレスを、ブラウザに貼って開いてください：${url}`,
      ),
    );
    opener.unref();
  } catch {
    console.log(
      `ブラウザを自動で開けませんでした。次のアドレスを、ブラウザに貼って開いてください：${url}`,
    );
  }
}

function readVersion(root) {
  try {
    return readFileSync(join(root, "VERSION"), "utf8").trim();
  } catch {
    return "";
  }
}

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const serverEntry = join(root, "app", "apps", "web", "src", "server", "index.ts");
  process.title = "ウチダイ";

  const version = readVersion(root);
  console.log(`ウチダイ${version ? ` ${version}` : ""} を起動します。`);
  if (!existsSync(serverEntry)) {
    console.error(
      "必要なファイルが見つかりません。ZIP を展開し直してから、もう一度お試しください。",
    );
    return 1;
  }

  // 1. 設定ファイル（任意）。値は表示しない
  let fileEnv = {};
  const envFile = join(root, "uchidai.env");
  if (existsSync(envFile)) {
    try {
      fileEnv = parseEnvFile(readFileSync(envFile, "utf8"));
      console.log("設定ファイル uchidai.env を読み込みました。");
    } catch {
      console.log(
        "設定ファイル uchidai.env を読めなかったので、使わずに続けます（書き方を確かめてください）。",
      );
    }
  }
  const env = mergeEnv(process.env, fileEnv);

  // 2. 手元だけ、保存先はユーザー領域
  if (env.API_HOST && env.API_HOST !== HOST) {
    console.log(
      "API_HOST は 127.0.0.1 に固定しています（手元以外へ公開しません）。API_HOST の指定は使いません。",
    );
  }
  env.API_HOST = HOST;
  env.NODE_ENV = "production";
  if (!env.UCHIDAI_DATA_DIR?.trim()) {
    env.UCHIDAI_DATA_DIR = defaultDataDir({ platform: process.platform, env, home: homedir() });
  }

  // 3. ポート
  const wanted = parsePort(env.API_PORT) ?? DEFAULT_PORT;
  const url = (port) => `http://${HOST}:${port}/`;
  const noBrowser = env.UCHIDAI_NO_BROWSER === "1";
  if (await isUchidaiRunning(wanted)) {
    console.log("ウチダイはすでに起動しています。そのまま画面を開きます。");
    console.log(`URL: ${url(wanted)}`);
    if (!noBrowser) openBrowser(url(wanted));
    return 0;
  }
  let port = await findFreePort(wanted);
  if (port === undefined) {
    console.error(
      `ポート ${wanted} から ${wanted + PORT_TRIES - 1} までがすべて使えません（他のアプリが使用中か、Windows などの設定で禁止されています）。他のアプリを終了するか、uchidai.env に API_PORT=（別の番号）を書いてください。`,
    );
    return 1;
  }
  if (port !== wanted)
    console.log(`ポート ${wanted} は別のアプリが使っているため、${port} で起動します。`);

  // 4. サーバの起動。確かめた直後に別のアプリに取られたときは、次の空きポートでやり直す（最大 3 回）
  let child;
  let stopping = false;
  const stop = () => {
    stopping = true;
    if (child && alive(child)) child.kill();
  };
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"]) process.on(signal, stop);
  process.on("exit", () => {
    if (child && alive(child)) child.kill();
  });

  let exited;
  for (let attempt = 1; ; attempt++) {
    env.API_PORT = String(port);
    const current = spawn(
      process.execPath,
      ["--disable-warning=ExperimentalWarning", serverEntry],
      {
        cwd: join(root, "app", "apps", "web"),
        env,
        stdio: "inherit",
      },
    );
    child = current;
    exited = new Promise((resolvePromise) => {
      current.once("exit", (code, signal) => resolvePromise({ code, signal }));
      current.once("error", (error) => {
        console.error(`サーバを起動できませんでした：${error.message}`);
        resolvePromise({ code: 1, signal: null });
      });
    });
    if (await waitForHealth(port, current, 60_000)) break;
    if (alive(current)) current.kill();
    const { code } = await exited;
    if (stopping) return 0;
    const next = attempt < 3 ? await findFreePort(port + 1) : undefined;
    if (next === undefined) {
      console.error(
        "サーバが起動しませんでした。上の表示（エラーの内容）を、開発者に伝えてください。",
      );
      return code || 1;
    }
    console.log(`ポート ${port} で起動できなかったので、${next} で起動し直します。`);
    port = next;
  }

  console.log("");
  console.log("ウチダイの準備ができました。");
  console.log(`URL: ${url(port)}`);
  console.log("ブラウザで画面が開きます。開かないときは、上のアドレスをブラウザに貼ってください。");
  console.log(`保存先（確認依頼など）：${env.UCHIDAI_DATA_DIR}`);
  console.log("");
  console.log("終了するには、このウィンドウを閉じてください（Ctrl+C でも止まります）。");
  if (!noBrowser) openBrowser(url(port));

  const { code, signal } = await exited;
  if (stopping || signal || code === 0 || code === null) return 0;
  console.error(`サーバが止まりました（コード ${code}）。`);
  return code;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(`起動に失敗しました：${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  },
);
