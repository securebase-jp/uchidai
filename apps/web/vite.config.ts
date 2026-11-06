import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiPort = Number(process.env.API_PORT ?? 8787);
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.WEB_PORT ?? 5173),
    proxy: { "/api": { target: `http://127.0.0.1:${apiPort}`, changeOrigin: true } },
    // 開発サーバの /@fs/ で配るファイルを、画面が要る場所に絞る（SEC-001）。
    // 既定はワークスペースの根（リポジトリ全体）で、送信箱の .data や eval/.cache まで読めてしまう。
    // 開発サーバは手元専用で、公開 URL に出すのは本番サーバ（pnpm build → 8787）だけ（docs/usage.md）
    fs: {
      strict: true,
      allow: [
        here,
        join(repoRoot, "packages"),
        join(repoRoot, "node_modules"),
        join(repoRoot, "demo"),
      ],
      deny: [".env", ".env.*", "*.{crt,pem}", "**/.git/**", "**/.data/**", "**/.cache/**"],
    },
  },
  build: { outDir: "dist", sourcemap: false },
});
