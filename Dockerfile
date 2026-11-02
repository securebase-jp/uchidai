# ウチダイ：特定のホスティング事業者の独自機能に依存しない単一イメージ
# 使い方は README の「Docker で動かす」を参照。API キーはイメージに入れず、実行時に渡す
FROM node:22-slim AS build
ENV CI=true
# pnpm は package.json の packageManager と同じ版。corepack は Node の fetch を使いプロキシ越しに失敗することがあるので npm で入れる
RUN npm install -g pnpm@10.33.0
WORKDIR /app
COPY . .
# 取得済みのパッケージは BuildKit のキャッシュに残し、失敗しても再試行で続きから進む。docker build が渡すプロキシ（HTTPS_PROXY）を pnpm にも使わせる（設定は環境変数だけで、イメージには残らない）
RUN --mount=type=cache,id=uchidai-pnpm,target=/pnpm/store if [ -n "$HTTPS_PROXY" ]; then export npm_config_https_proxy="$HTTPS_PROXY" npm_config_proxy="${HTTP_PROXY:-$HTTPS_PROXY}"; fi && export npm_config_store_dir=/pnpm/store npm_config_network_concurrency=4 npm_config_fetch_retries=8 npm_config_fetch_timeout=120000 && pnpm install --frozen-lockfile --ignore-scripts && pnpm build

FROM node:22-slim
ENV NODE_ENV=production \
    API_HOST=0.0.0.0 \
    API_PORT=8787
# pnpm は package.json の packageManager と同じ版。corepack は Node の fetch を使いプロキシ越しに失敗することがあるので npm で入れる
RUN npm install -g pnpm@10.33.0
WORKDIR /app
COPY . .
RUN --mount=type=cache,id=uchidai-pnpm,target=/pnpm/store if [ -n "$HTTPS_PROXY" ]; then export npm_config_https_proxy="$HTTPS_PROXY" npm_config_proxy="${HTTP_PROXY:-$HTTPS_PROXY}"; fi && export npm_config_store_dir=/pnpm/store npm_config_network_concurrency=4 npm_config_fetch_retries=8 npm_config_fetch_timeout=120000 && pnpm install --frozen-lockfile --prod --ignore-scripts
COPY --from=build /app/apps/web/dist ./apps/web/dist
# サーバが書くのは確認依頼の保存先（apps/web/.data）だけ
RUN mkdir -p apps/web/.data && chown -R node:node apps/web/.data
USER node
WORKDIR /app/apps/web
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:8787/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--disable-warning=ExperimentalWarning", "src/server/index.ts"]
