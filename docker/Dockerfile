# syntax=docker/dockerfile:1.7
#
# 同一个 Dockerfile 出两个镜像（web / worker），共享 deps 与 builder 阶段。
# 构建：
#   docker build -f docker/Dockerfile --target web    -t pb-web .
#   docker build -f docker/Dockerfile --target worker -t pb-worker .

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app

# ── 依赖层：只拷清单，最大化缓存命中 ──────────────────
FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc ./
COPY packages/contract/package.json packages/contract/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
RUN pnpm install --frozen-lockfile

# ── 构建层 ────────────────────────────────────────────
FROM deps AS builder
COPY . .
RUN pnpm --filter @pb/web build

# ── 运行时：worker ────────────────────────────────────
# 用 tsx 跑 TS 源码。不能用 node --experimental-strip-types：
# 类型剥离不支持无扩展名的相对导入（import './schema'），而 workspace 包
# 内部全是这种写法，会在启动瞬间 MODULE_NOT_FOUND。
FROM base AS worker
ENV NODE_ENV=production
COPY --from=builder /app ./
CMD ["node", "node_modules/tsx/dist/cli.mjs", "apps/worker/src/index.ts"]

# ── 运行时：web ───────────────────────────────────────
FROM base AS web
ENV NODE_ENV=production
COPY --from=builder /app ./
COPY docker/entrypoint-web.sh /usr/local/bin/entrypoint-web.sh
RUN chmod +x /usr/local/bin/entrypoint-web.sh
EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/entrypoint-web.sh"]

# ── 运行时：browser（可选的无头浏览器服务）─────────────
# 单独一个 target 的原因：Chromium 会把镜像撑到几百 MB，
# 不需要页面渲染的用户完全没必要拉这份体积。
#
# 用 Debian 自带的 chromium 而不是 playwright 官方镜像（~1.9GB）：
# 后者省事但太重，而这里只需要一个能跑 JS 的浏览器。
FROM node:22-bookworm-slim AS browser
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CHROMIUM_PATH=/usr/bin/chromium
RUN corepack enable \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
         chromium \
         fonts-noto-cjk \
         ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc ./
COPY packages/contract/package.json packages/contract/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY apps/browser/package.json apps/browser/
RUN pnpm install --frozen-lockfile --prod=false
COPY . .
EXPOSE 3001
# 容器里没有 systemd，Chromium 需要下面这个开关并且要足够的 /dev/shm
CMD ["node", "node_modules/tsx/dist/cli.mjs", "apps/browser/src/server.ts"]
