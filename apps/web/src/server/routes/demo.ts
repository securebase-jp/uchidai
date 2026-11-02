/**
 * デモモードの音声：demo/audio/<n>.wav（git 管理外）を配り、長さの一覧を返す。
 * GET /api/demo/audio → {available: {"1": 12.3, ...}}（durations.json があれば秒数、無ければ true）
 * GET /api/demo/audio/:n → audio/wav
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "@uchidai/engine";
import { Hono } from "hono";
import { z } from "zod";

const SceneNumber = z.coerce.number().int().min(1).max(50);
const audioDir = () => join(repoRoot, "demo", "audio");

export const demoRoutes = new Hono();

demoRoutes.get("/api/demo/audio", (c) => {
  const dir = audioDir();
  const available: Record<string, number | true> = {};
  if (!existsSync(dir)) return c.json({ available });
  let durations: Record<string, number> = {};
  const durPath = join(dir, "durations.json");
  if (existsSync(durPath)) {
    try {
      durations = z
        .record(z.string(), z.number().positive())
        .parse(JSON.parse(readFileSync(durPath, "utf8")));
    } catch {
      durations = {};
    }
  }
  for (const f of readdirSync(dir)) {
    const m = /^(\d+)\.wav$/.exec(f);
    if (!m?.[1]) continue;
    const n = String(Number(m[1]));
    available[n] = durations[n] ?? true;
  }
  return c.json({ available });
});

demoRoutes.get("/api/demo/audio/:n", (c) => {
  const parsed = SceneNumber.safeParse(c.req.param("n"));
  if (!parsed.success) return c.json({ error: "場面番号が正しくありません" }, 400);
  const path = join(audioDir(), `${parsed.data}.wav`);
  if (!existsSync(path)) return c.json({ error: `音声 ${parsed.data}.wav はありません` }, 404);
  const body = new Uint8Array(readFileSync(path));
  return c.body(body, 200, {
    "content-type": "audio/wav",
    "content-length": String(body.byteLength),
    "cache-control": "no-cache",
  });
});
