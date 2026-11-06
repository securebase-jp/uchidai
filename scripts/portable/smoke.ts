/**
 * 展開したポータブル ZIP の起動のスモークテスト。
 *
 *   node --disable-warning=ExperimentalWarning scripts/portable/smoke.ts <展開したフォルダ> [--port 18787]
 *
 * 利用者と同じように、起動のファイル（.bat / .command / start.sh）を実行する。ただし PATH から node と pnpm を外し、
 * 同梱の Node だけで動くことを確かめる。確かめること：
 *   1. /api/health が 200（{ ok: true }）
 *   2. 画面の HTML が返り、そこから参照されるスクリプトも取れる
 *   3. API キー不要の判定（記録済みの IPA 事例 × デモの会社カルテ → /api/evaluate）が答える
 *   4. 保存先（UCHIDAI_DATA_DIR）に、ZIP のフォルダの外へファイルが書かれ、ZIP のフォルダの中には .data ができない
 *   5. 終了させるとサーバも止まる
 * ブラウザは開かない（UCHIDAI_NO_BROWSER=1）。失敗したら、起動したプロセスの出力を表示して終了コード 1 にする。
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const isWin = process.platform === "win32";

type Check = { name: string; ok: boolean; detail?: string };
const checks: Check[] = [];
function record(name: string, ok: boolean, detail?: string): void {
  checks.push({ name, ok, ...(detail ? { detail } : {}) });
  console.log(`${ok ? "OK  " : "NG  "} ${name}${detail ? `：${detail}` : ""}`);
}

/** 利用者の環境に近い、node も pnpm も無い環境変数（秘密の値は引き継がない） */
export function minimalEnv(
  base: NodeJS.ProcessEnv,
  extra: Record<string, string>,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(base)) {
    if (/^path$/i.test(key)) continue;
    if (
      /^(ANTHROPIC_|SMTP_|MAIL_FROM|API_|UCHIDAI_|NODE_|npm_|PNPM_|HTTPS?_PROXY|NO_PROXY)/i.test(
        key,
      )
    )
      continue;
    env[key] = value;
  }
  env[isWin ? "Path" : "PATH"] = isWin
    ? `${base.SystemRoot ?? "C:\\Windows"}\\System32;${base.SystemRoot ?? "C:\\Windows"}`
    : "/usr/bin:/bin";
  return { ...env, ...extra };
}

/** 起動のファイルの名前（build-zip.ts の PLATFORM_TEXT と同じ）。展開したフォルダの中の名前は使わず、固定の名前だけを実行する */
function launcherName(dir: string): string {
  const name = isWin
    ? "ウチダイを起動.bat"
    : process.platform === "darwin"
      ? "ウチダイを起動.command"
      : "start.sh";
  if (!existsSync(join(dir, name))) throw new Error(`起動のファイルが見つかりません（${dir}）`);
  return name;
}

async function getText(url: string, init?: RequestInit): Promise<{ status: number; body: string }> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
  return { status: res.status, body: await res.text() };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<number> {
  const dir = resolve(process.argv[2] ?? "");
  if (!process.argv[2] || !existsSync(dir)) {
    console.error("使い方: node scripts/portable/smoke.ts <展開したフォルダ> [--port 18787]");
    return 2;
  }
  const portArg = process.argv.indexOf("--port");
  const port = Number(portArg >= 0 ? process.argv[portArg + 1] : 18787);
  const dataDir = mkdtempSync(join(tmpdir(), "uchidai-smoke-data-"));
  const launcher = launcherName(dir);

  const env = minimalEnv(process.env, {
    UCHIDAI_NO_BROWSER: "1",
    API_PORT: String(port),
    UCHIDAI_DATA_DIR: dataDir,
  });
  let output = "";
  const child = isWin
    ? spawn("cmd.exe", ["/d", "/c", launcher], { cwd: dir, env, windowsHide: true })
    : spawn(`./${launcher}`, [], { cwd: dir, env, detached: true });
  child.stdout?.on("data", (d: Buffer) => {
    output += d.toString("utf8");
  });
  child.stderr?.on("data", (d: Buffer) => {
    output += d.toString("utf8");
  });
  let exited = false;
  child.once("exit", () => {
    exited = true;
  });

  const stop = async (): Promise<void> => {
    if (exited) return;
    if (isWin) {
      // cmd → node（起動処理）→ node（サーバ）の木を、まとめて止める
      spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      // ターミナルのウィンドウを閉じたときと同じく、プロセスのグループ全体に SIGHUP を送る
      try {
        process.kill(-(child.pid ?? 0), "SIGHUP");
      } catch {
        // すでに終わっている
      }
    }
    for (let i = 0; i < 50 && !exited; i++) await sleep(100);
  };

  let code = 0;
  try {
    // 1. 起動と /api/health（最大 90 秒）
    const base = `http://127.0.0.1:${port}`;
    let health: { status: number; body: string } | undefined;
    for (let i = 0; i < 300 && !exited; i++) {
      try {
        health = await getText(`${base}/api/health`);
        if (health.status === 200) break;
      } catch {
        // まだ起動中
      }
      await sleep(300);
    }
    record(
      "起動して /api/health が 200",
      health?.status === 200 && JSON.parse(health.body).ok === true,
      health?.body,
    );
    if (health?.status !== 200) throw new Error("起動しませんでした");
    // 起動処理は、応答が 2 回続いてから案内を出すので、少し待つ
    for (let i = 0; i < 50 && !output.includes("ウィンドウを閉じ"); i++) await sleep(200);
    record(
      "起動の表示に URL と終了の案内がある",
      output.includes(`http://127.0.0.1:${port}/`) && output.includes("ウィンドウを閉じ"),
    );

    // 2. 画面
    const index = await getText(`${base}/`);
    record("画面の HTML が返る", index.status === 200 && index.body.includes('<div id="root">'));
    const script = /src="(\/assets\/[^"]+\.js)"/.exec(index.body)?.[1];
    const asset = script ? await getText(`${base}${script}`) : undefined;
    record(
      "画面のスクリプトが取れる",
      asset?.status === 200 && (asset?.body.length ?? 0) > 1000,
      script,
    );
    const deep = await getText(`${base}/some/deep/link`);
    record(
      "存在しないパスでも画面の HTML が返る（SPA）",
      deep.status === 200 && deep.body.includes('<div id="root">'),
    );

    // 3. API キー不要の判定
    const rec = await getText(`${base}/api/case/recorded/ipa-case-1`);
    const example = await getText(`${base}/api/examples/demo-seiko`);
    record(
      "記録済みの事例とデモの会社カルテが読める",
      rec.status === 200 && example.status === 200,
    );
    if (rec.status === 200 && example.status === 200) {
      const theCase = JSON.parse(rec.body).case;
      const profile = JSON.parse(example.body).profile;
      const ev = await getText(`${base}/api/evaluate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ case: theCase, profile }),
      });
      const verdict = ev.status === 200 ? JSON.parse(ev.body).verdict : undefined;
      record(
        "IPA 事例の判定（/api/evaluate）が答える",
        ev.status === 200 && verdict !== undefined,
        `status ${ev.status}`,
      );
    }

    // 4. 保存先
    const token = await getText(`${base}/api/recon/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ domain: "smoke-test.example" }),
    });
    record(
      "所有確認のトークンを発行できる",
      token.status === 200 || token.status === 201,
      `status ${token.status}`,
    );
    record(
      "保存先（UCHIDAI_DATA_DIR）にファイルが書かれる",
      existsSync(join(dataDir, "recon-tokens.json")),
    );
    record(
      "ZIP のフォルダの中に .data ができない",
      !existsSync(join(dir, "app", "apps", "web", ".data")),
    );
    const health2 = await getText(`${base}/api/health`);
    record(
      "ANTHROPIC_API_KEY が無くても動く（readAvailable は false）",
      JSON.parse(health2.body).readAvailable === false,
    );
  } catch (error) {
    record(
      "スモークテストの途中で例外",
      false,
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    await stop();
    // 5. 終了
    record(
      "終了させるとサーバも止まる",
      exited &&
        (await getText(`http://127.0.0.1:${port}/api/health`).then(
          () => false,
          () => true,
        )),
    );
    rmSync(dataDir, { recursive: true, force: true });
  }

  const failed = checks.filter((c) => !c.ok);
  if (failed.length > 0) {
    console.log("\n--- 起動したプロセスの出力 ---");
    console.log(output);
    console.log(`--- ${failed.length} 件失敗 ---`);
    code = 1;
  } else {
    console.log(`\nすべて通りました（${checks.length} 件）`);
  }
  return code;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      console.error(error);
      process.exit(1);
    },
  );
}
