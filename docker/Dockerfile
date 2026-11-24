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
# 直接用 node 的类型剥离跑 TS，省掉一层编译产物
FROM base AS worker
ENV NODE_ENV=production
COPY --from=builder /app ./
CMD ["node", "--experimental-strip-types", "apps/worker/src/index.ts"]

# ── 运行时：web ───────────────────────────────────────
FROM base AS web
ENV NODE_ENV=production
COPY --from=builder /app ./
COPY docker/entrypoint-web.sh /usr/local/bin/entrypoint-web.sh
RUN chmod +x /usr/local/bin/entrypoint-web.sh
EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/entrypoint-web.sh"]
