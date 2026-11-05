import assert from "node:assert/strict";
import net from "node:net";
import { test } from "node:test";
import {
  defaultDataDir,
  findFreePort,
  isUchidaiRunning,
  mergeEnv,
  openCommand,
  parseEnvFile,
  parsePort,
} from "./launcher-lib.mjs";

test("保存先：Windows は %APPDATA%\\uchidai、無ければ AppData\\Roaming の下", () => {
  const withAppData = defaultDataDir({
    platform: "win32",
    env: { APPDATA: "C:\\Users\\a\\AppData\\Roaming" },
    home: "C:\\Users\\a",
  });
  assert.match(withAppData, /AppData[\\/]Roaming[\\/]uchidai$/);
  const without = defaultDataDir({ platform: "win32", env: {}, home: "C:\\Users\\a" });
  assert.match(without, /AppData[\\/]Roaming[\\/]uchidai$/);
});

test("保存先：macOS は ~/Library/Application Support/uchidai", () => {
  const dir = defaultDataDir({ platform: "darwin", env: {}, home: "/Users/a" });
  assert.equal(dir, "/Users/a/Library/Application Support/uchidai");
});

test("保存先：Linux は XDG_DATA_HOME があればその下、無ければ ~/.local/share/uchidai", () => {
  assert.equal(
    defaultDataDir({ platform: "linux", env: { XDG_DATA_HOME: "/x/data" }, home: "/home/a" }),
    "/x/data/uchidai",
  );
  assert.equal(
    defaultDataDir({ platform: "linux", env: {}, home: "/home/a" }),
    "/home/a/.local/share/uchidai",
  );
});

test("uchidai.env：BOM、コメント、引用符、CRLF を読める。値は返すだけ", () => {
  const parsed = parseEnvFile(
    '\uFEFF# メモ\r\nAPI_PORT=8800\r\nHTTPS_PROXY="http://proxy.example.co.jp:8080"\r\n# ANTHROPIC_API_KEY=\r\n',
  );
  assert.equal(parsed.API_PORT, "8800");
  assert.equal(parsed.HTTPS_PROXY, "http://proxy.example.co.jp:8080");
  assert.equal("ANTHROPIC_API_KEY" in parsed, false);
});

test("環境変数が先で、ファイルは足りないものだけ補う（空の環境変数は未設定とみなす）", () => {
  const merged = mergeEnv({ A: "env", B: "" }, { A: "file", B: "file", C: "file" });
  assert.deepEqual(merged, { A: "env", B: "file", C: "file" });
});

test("ポート番号の検査", () => {
  assert.equal(parsePort("8787"), 8787);
  assert.equal(parsePort("65535"), 65535);
  for (const bad of ["", "0", "65536", "-1", "80a", "8.7", undefined])
    assert.equal(parsePort(bad), undefined, String(bad));
});

test("空きポートの探索：使用中を飛ばして次を選び、尽きたら undefined", async () => {
  const taken = new Set([9000, 9001]);
  const check = async (p: number) => !taken.has(p);
  assert.equal(await findFreePort(9000, 5, check), 9002);
  assert.equal(await findFreePort(9000, 2, check), undefined);
  assert.equal(await findFreePort(9100, 3, check), 9100);
});

test("空きポートの探索（実際の待ち受け）：占有されたポートを避ける", async (t) => {
  const server = net.createServer();
  const listening = await new Promise<boolean>((resolve) => {
    server.once("error", () => resolve(false));
    server.listen({ port: 0, host: "127.0.0.1" }, () => resolve(true));
  });
  if (!listening) {
    t.skip("この環境では待ち受けできない（サンドボックスなど）");
    return;
  }
  const { port } = server.address() as net.AddressInfo;
  try {
    const found = await findFreePort(port, 5);
    assert.ok(found !== undefined && found !== port);
  } finally {
    server.close();
  }
});

test("ブラウザを開くコマンド", () => {
  assert.deepEqual(openCommand("win32", "http://127.0.0.1:8787/"), {
    command: "cmd.exe",
    args: ["/d", "/c", "start", '""', "http://127.0.0.1:8787/"],
  });
  assert.deepEqual(openCommand("darwin", "http://127.0.0.1:8787/"), {
    command: "open",
    args: ["http://127.0.0.1:8787/"],
  });
  assert.equal(openCommand("linux", "http://127.0.0.1:8787/").command, "xdg-open");
});

test("すでにウチダイが動いているかの判定は、/api/health の形で決める", async () => {
  const ok = async () =>
    new Response(JSON.stringify({ ok: true, readAvailable: false }), { status: 200 });
  const other = async () => new Response(JSON.stringify({ ok: true }), { status: 200 });
  const down = async () => {
    throw new Error("ECONNREFUSED");
  };
  assert.equal(await isUchidaiRunning(8787, ok), true);
  assert.equal(await isUchidaiRunning(8787, other), false);
  assert.equal(await isUchidaiRunning(8787, down), false);
});
