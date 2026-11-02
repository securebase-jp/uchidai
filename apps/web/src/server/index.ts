/**
 * サーバの起動。開発時は Vite が /api をここへプロキシし、本番は dist/ をここから配信する
 */
import { existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { app } from "./app.ts";

const port = Number(process.env.API_PORT ?? 8787);
// 既定は手元だけ（127.0.0.1）。Docker では API_HOST=0.0.0.0 にして、公開は `-p 127.0.0.1:8787:8787` で手元に絞る
const hostname = process.env.API_HOST ?? "127.0.0.1";
const distDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "dist");

if (existsSync(distDir)) {
  const root = relative(process.cwd(), distDir) || ".";
  app.use("/*", serveStatic({ root }));
  app.get("*", serveStatic({ root, path: "index.html" }));
}

serve({ fetch: app.fetch, port, hostname }, (info) => {
  console.log(`[uchidai api] http://${hostname}:${info.port}`);
  if (!process.env.ANTHROPIC_API_KEY)
    console.log(
      "[uchidai api] ANTHROPIC_API_KEY 未設定：記事の読解は使えません（記録済みの事例は使えます）",
    );
});
