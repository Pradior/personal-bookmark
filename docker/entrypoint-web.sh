#!/bin/sh
set -e

APP_SHORT="${APP_SHORT:-pb}"
PORT="${PORT:-3000}"

echo "[${APP_SHORT}-web] 启动中…"

# 迁移：扩展 → 表结构 → 函数索引（详见 packages/db/src/migrate.ts）
if [ "${AUTO_MIGRATE:-true}" = "true" ]; then
  echo "[${APP_SHORT}-web] 运行数据库迁移…"
  if ! node --experimental-strip-types packages/db/src/migrate.ts; then
    echo "[${APP_SHORT}-web] ❌ 迁移失败。检查 DATABASE_URL 与 pb-db 是否健康。" >&2
    exit 1
  fi
else
  echo "[${APP_SHORT}-web] 已跳过迁移（AUTO_MIGRATE=false）"
fi

# 直接调 next，不经 pnpm：少一层进程，也不会因为 HOME 不可写而失败
cd apps/web
exec node ../../node_modules/next/dist/bin/next start \
  --port "$PORT" \
  --hostname 0.0.0.0
