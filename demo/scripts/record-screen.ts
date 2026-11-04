/**
 * デモモードを、ヘッドレス Chromium で撮る（macOS の画面収録の許可を使わない）。
 *   node demo/scripts/record-screen.ts [--url <デモの URL>] [--out demo/capture] [--fps 30] [--seconds 181]
 *                                      [--width 1920] [--height 1080] [--keep-frames]
 * 仕組み：ヘッドレスの Chromium でデモを実時間で動かし、Page.startScreencast で絵を取る。開始ボタンを押した時刻を 0 秒として、
 * フレームの時刻から一定のコマ数（既定 30fps）の mp4 にする。動きの少ない場面ではコマが少なく、そのぶん前のコマを保つ。
 * 出力：<out>/screen.mp4（映像のみ。1920×1080、H.264）。音声・字幕・効果音は assemble.ts で足す。
 * 前提：開発サーバが動いている（pnpm dev）。デモの音声（demo/audio/*.wav）があれば、場面の長さは音声の長さになる。
 * ヘッドレスシェルは ~/Library/Caches/ms-playwright の chromium_headless_shell-（版）にあるものを使う（無ければ手順を表示して終わる）。
 * ブラウザの接続はローカルのデバッグポートだけ。外部には出ない。
 */
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { audioDir, demoRoot } from "./lib.ts";

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const url = arg("url") ?? "http://localhost:5173/?profile=demo-seiko&demo=1&controls=0&autostart=0";
const outDir = resolve(arg("out") ?? join(demoRoot, "capture"));
const fps = Number(arg("fps", "30"));
const width = Number(arg("width", "1920"));
const height = Number(arg("height", "1080"));
const seconds = Number(arg("seconds", "181"));
const port = Number(arg("port", "9333"));

function findShell(): string {
  const base = join(homedir(), "Library", "Caches", "ms-playwright");
  const dirs = existsSync(base)
    ? readdirSync(base).filter((d) => d.startsWith("chromium_headless_shell-"))
    : [];
  for (const d of dirs.sort().reverse()) {
    const p = join(base, d, "chrome-headless-shell-mac-arm64", "chrome-headless-shell");
    if (existsSync(p)) return p;
  }
  console.error(
    "chrome-headless-shell が見つかりません（~/Library/Caches/ms-playwright/chromium_headless_shell-*）。Playwright の Chromium を入れてから、もう一度実行してください。",
  );
  process.exit(2);
}

// --- 最小の CDP クライアント（Node 22+ の WebSocket） ---
type Pending = { resolve: (v: any) => void; reject: (e: Error) => void };
class Cdp {
  private ws: WebSocket;
  private id = 0;
  private pending = new Map<number, Pending>();
  private listeners: Array<(m: any) => void> = [];
  constructor(ws: WebSocket) {
    this.ws = ws;
    ws.addEventListener("message", (ev) => {
      const m = JSON.parse(String(ev.data));
      if (m.id !== undefined) {
        const p = this.pending.get(m.id);
        if (!p) return;
        this.pending.delete(m.id);
        if (m.error) p.reject(new Error(`${m.error.message}`));
        else p.resolve(m.result);
      } else for (const l of this.listeners) l(m);
    });
  }
  static async connect(wsUrl: string): Promise<Cdp> {
    const ws = new WebSocket(wsUrl);
    await new Promise<void>((res, rej) => {
      ws.addEventListener("open", () => res());
      ws.addEventListener("error", () => rej(new Error("CDP に接続できません")));
    });
    return new Cdp(ws);
  }
  send(method: string, params: object = {}, sessionId?: string): Promise<any> {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  on(l: (m: any) => void) {
    this.listeners.push(l);
  }
  waitFor(method: string, sessionId: string, timeoutMs: number): Promise<any> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`${method} を待って時間切れ`)), timeoutMs);
      const l = (m: any) => {
        if (m.method === method && m.sessionId === sessionId) {
          clearTimeout(t);
          this.listeners = this.listeners.filter((x) => x !== l);
          resolve(m.params);
        }
      };
      this.listeners.push(l);
    });
  }
  close() {
    this.ws.close();
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const shell = findShell();
  const profile = join(tmpdir(), `uchidai-rec-${process.pid}`);
  mkdirSync(profile, { recursive: true });
  const framesDir = join(outDir, "frames");
  rmSync(framesDir, { recursive: true, force: true });
  mkdirSync(framesDir, { recursive: true });

  const chrome: ChildProcess = spawn(
    shell,
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      "--hide-scrollbars",
      "--mute-audio",
      "--font-render-hinting=none",
      "--force-device-scale-factor=1",
      "--autoplay-policy=no-user-gesture-required",
      `--window-size=${width},${height}`,
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  const browserWs = await new Promise<string>((resolve, reject) => {
    let buf = "";
    const t = setTimeout(() => reject(new Error("ブラウザの起動を待って時間切れ")), 20000);
    chrome.stderr?.on("data", (d) => {
      buf += String(d);
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m?.[1]) {
        clearTimeout(t);
        resolve(m[1]);
      }
    });
    chrome.on("exit", () => reject(new Error("ブラウザが終了しました")));
  });
  const cdp = await Cdp.connect(browserWs);
  const cleanup = () => {
    try {
      cdp.close();
    } catch {}
    chrome.kill("SIGKILL");
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {}
  };
  process.on("SIGINT", () => {
    cleanup();
    process.exit(130);
  });

  try {
    const { targetId } = await cdp.send("Target.createTarget", {
      url: "about:blank",
      width,
      height,
    });
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    const S = (method: string, params: object = {}) => cdp.send(method, params, sessionId);
    await S("Page.enable");
    await S("Runtime.enable");
    await S("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });

    // 読み込み（実時間）。フォントと開始ボタンが出るまで待つ
    const loaded = cdp.waitFor("Page.loadEventFired", sessionId, 60000);
    await S("Page.navigate", { url });
    await loaded;
    const evalJs = async (expression: string) =>
      (await S("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result
        ?.value;
    for (let i = 0; i < 120; i++) {
      const ready = await evalJs(
        "!!document.querySelector('.demo-start') && !document.querySelector('.demo-gate .muted')?.textContent?.includes('準備しています')",
      );
      if (ready) break;
      await sleep(500);
    }
    await evalJs("document.fonts.ready.then(() => true)");
    await sleep(800);

    // 実時間で動かし、Chromium の screencast で絵を取る（このアプリのデモの時計は壁時計で進む）。
    // 開始ボタンを押した時刻を 0 秒として、フレームの時刻を ffmpeg の連結リストにする
    type Frame = { file: string; t: number };
    const frames: Frame[] = [];
    let writes: Promise<void>[] = [];
    let counter = 0;
    let t0: number | undefined;
    cdp.on((m) => {
      if (m.method !== "Page.screencastFrame" || m.sessionId !== sessionId) return;
      const { data, metadata, sessionId: ackId } = m.params;
      void S("Page.screencastFrameAck", { sessionId: ackId });
      if (t0 === undefined) return;
      const t = Number(metadata.timestamp);
      if (t < t0) return;
      const file = join(framesDir, `${String(++counter).padStart(6, "0")}.jpg`);
      frames.push({ file, t: t - t0 });
      writes.push(writeFile(file, Buffer.from(data, "base64")));
    });
    await S("Page.startScreencast", {
      format: "jpeg",
      quality: 92,
      maxWidth: width,
      maxHeight: height,
      everyNthFrame: 1,
    });
    await sleep(500);
    t0 = Date.now() / 1000;
    await evalJs("document.querySelector('.demo-start').click()");
    const started = Date.now();
    while ((Date.now() - started) / 1000 < seconds) {
      await sleep(5000);
      console.log(
        `  ${((Date.now() - started) / 1000).toFixed(0)} 秒 / ${seconds} 秒（${frames.length} コマ）`,
      );
    }
    await S("Page.stopScreencast");
    await Promise.all(writes);
    writes = [];
    // 連結リスト（各コマを、次のコマまで表示）
    const lines: string[] = [];
    frames.forEach((f, k) => {
      const next = frames[k + 1]?.t ?? Math.min(seconds, f.t + 1 / fps);
      lines.push(`file '${f.file}'`, `duration ${Math.max(0.001, next - f.t).toFixed(4)}`);
    });
    const last = frames[frames.length - 1];
    if (last) lines.push(`file '${last.file}'`);
    writeFileSync(join(outDir, "frames.txt"), `${lines.join("\n")}\n`);
    console.log(
      `撮れたコマ：${frames.length}（平均 ${(frames.length / seconds).toFixed(1)} コマ/秒）`,
    );
  } finally {
    cleanup();
  }

  // 連番の JPEG を 1 本の mp4 にする
  const out = join(outDir, "screen.mp4");
  const ff = spawnSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      join(outDir, "frames.txt"),
      "-t",
      String(seconds),
      "-vf",
      `fps=${fps}`,
      "-c:v",
      "libx264",
      "-preset",
      "slow",
      "-crf",
      "14",
      "-pix_fmt",
      "yuv420p",
      "-r",
      String(fps),
      out,
    ],
    { stdio: "inherit" },
  );
  if (ff.status !== 0) {
    console.error("ffmpeg が失敗しました");
    process.exit(1);
  }
  if (!flag("keep-frames")) rmSync(framesDir, { recursive: true, force: true });
  console.log(
    `書き出しました：${out}（音声は ${audioDir} の場面ごとの WAV を assemble.ts で足します）`,
  );
}

await main();
