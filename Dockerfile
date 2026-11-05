# ウチダイ：特定のホスティング事業者の独自機能に依存しない単一イメージ
# 使い方は docs/install.md を参照。API キーはイメージに入れず、実行時に渡す
#
# 画面（dist）は CPU の種類によらず同じ中身なので、ビルド段は実行する側ではなくビルドする側の CPU で動かす。
# linux/arm64 のイメージを amd64 の機械で作るときも、遅いエミュレーションで走るのは最終段の依存の取得だけで済む
FROM --platform=$BUILDPLATFORM node:22-slim AS build
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
WORKDIR /app
# 本番に要るものだけを入れる（テスト、評価の結果、デモの素材、ドキュメントは入れない）。
# 実行時に読むのは knowledge/（判定の知識）、examples/（例のカルテ）、eval/recordings/（記録済みの読解と AI攻撃者）、各パッケージの src/
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY eval/package.json eval/package.json
COPY demo/package.json demo/package.json
COPY packages packages
# pnpm は package.json の packageManager と同じ版。corepack は Node の fetch を使いプロキシ越しに失敗することがあるので npm で入れる。
# 依存を入れたら pnpm も npm のキャッシュも消す（実行には要らない。同じ層の中で消すので、イメージは小さくなる）
RUN --mount=type=cache,id=uchidai-pnpm,target=/pnpm/store npm install -g pnpm@10.33.0 \
 && if [ -n "$HTTPS_PROXY" ]; then export npm_config_https_proxy="$HTTPS_PROXY" npm_config_proxy="${HTTP_PROXY:-$HTTPS_PROXY}"; fi \
 && export npm_config_store_dir=/pnpm/store npm_config_network_concurrency=4 npm_config_fetch_retries=8 npm_config_fetch_timeout=120000 \
 && pnpm install --frozen-lockfile --prod --ignore-scripts --filter "@uchidai/web..." \
 && npm uninstall -g pnpm && npm cache clean --force && rm -rf /root/.npm /root/.cache
COPY apps/web/src apps/web/src
COPY knowledge knowledge
COPY examples examples
COPY eval/recordings eval/recordings
COPY --from=build /app/apps/web/dist apps/web/dist
# サーバが書くのは確認依頼と所有確認のトークン、KEV のキャッシュ（apps/web/.data）だけ。
# 名前つきボリュームをここに置くと、最初に作るときにこの持ち主（node）が引き継がれ、書き込める
RUN mkdir -p apps/web/.data && chown -R node:node apps/web/.data
USER node
WORKDIR /app/apps/web
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD node -e "fetch('http://127.0.0.1:8787/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--disable-warning=ExperimentalWarning", "src/server/index.ts"]
