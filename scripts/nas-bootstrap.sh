#!/bin/sh
# 在空目录里初始化部署环境：建 data 目录 + 生成 .env（随机密钥）。
#
#   sh scripts/nas-bootstrap.sh          # 默认 WEB_PORT=3081
#   sh scripts/nas-bootstrap.sh 38080    # 指定端口
#
# 只做两件事，不碰容器。之后自行：
#   docker compose pull && docker compose up -d
set -e

PORT="${1:-3081}"

echo "==> 初始化目录（当前：$(pwd)）"
mkdir -p data/db data/assets data/config
echo "    data/{db,assets,config} 就绪"

if [ -f .env ]; then
  echo "==> .env 已存在，跳过生成（不会覆盖你已有的密钥）"
  exit 0
fi

# base64url：避免 / 和 + 出现在 DATABASE_URL 的密码段里把连接串拆坏
gen_secret() {
  bytes="$1"
  if command -v node >/dev/null 2>&1; then
    node -e "process.stdout.write(require('crypto').randomBytes($bytes).toString('base64url'))"
  elif command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 "$bytes" | tr -d '\n=' | tr '+/' '-_'
  else
    echo "需要 node 或 openssl 之一来生成密钥" >&2
    exit 1
  fi
}

DB_PASSWORD="$(gen_secret 18)"
AUTH_SECRET="$(gen_secret 32)"

cat > .env <<EOF
# 由 scripts/nas-bootstrap.sh 生成于 $(date '+%Y-%m-%d %H:%M:%S')
DB_PASSWORD=$DB_PASSWORD
AUTH_SECRET=$AUTH_SECRET

APP_NAME=个人bookmark
APP_SHORT=pb
WEB_PORT=$PORT
TZ=Asia/Shanghai
PUBLIC_BASE_URL=http://localhost:$PORT

IMAGE_REPO=ghcr.io/pradior
TAG=latest
PULL_POLICY=always
AUTO_MIGRATE=true
EOF

chmod 600 .env

echo "==> 已生成 .env（WEB_PORT=$PORT，密钥随机）"
echo
echo "下一步："
echo "  echo <你的PAT> | docker login ghcr.io -u Pradior --password-stdin   # 私有镜像才需要"
echo "  docker compose pull && docker compose up -d"
echo "  docker compose logs -f pb-web      # 首启密码在这里（打开一次登录页后才会生成）"
