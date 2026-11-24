#!/bin/sh
# 在 NAS 上从一个已 clone 的仓库更新并重启。
#
#   sh scripts/nas-deploy.sh
#
# 做的事：拉最新代码 → 重建镜像 → 等 pb-web 变 healthy → 打印状态。
# 前提：仓库目录里已经有 .env 和 data/{db,assets,config}。
set -e

cd "$(dirname "$0")/.."

# 有的机器 docker 需要 sudo
if docker info >/dev/null 2>&1; then
  DC="docker"
else
  DC="sudo docker"
  echo "（docker 需要 sudo，已自动加上）"
fi

echo "==> 当前提交: $(git rev-parse --short HEAD) $(git log -1 --pretty=%s)"

echo "==> 检查 .env"
if [ ! -f .env ]; then
  echo "❌ 缺少 .env。先 cp .env.example .env 并填 DB_PASSWORD / AUTH_SECRET" >&2
  exit 1
fi

echo "==> 拉取最新代码"
git pull --ff-only

echo "==> 更新到: $(git rev-parse --short HEAD) $(git log -1 --pretty=%s)"

echo "==> 重建并启动（N100 上可能几分钟）"
$DC compose up -d --build

echo "==> 等待 pb-web 健康检查通过…"
i=0
while [ $i -lt 60 ]; do
  status=$($DC compose ps --format '{{.Status}}' pb-web 2>/dev/null || true)
  case "$status" in
    *healthy*)
      echo "✅ pb-web: $status"
      break
      ;;
    *unhealthy*)
      echo "❌ pb-web unhealthy，看日志：" >&2
      $DC compose logs --tail 60 pb-web >&2
      exit 1
      ;;
  esac
  i=$((i + 1))
  sleep 5
done

if [ $i -ge 60 ]; then
  echo "⚠ 等了 5 分钟仍未见 healthy，当前状态：" >&2
  $DC compose ps
  echo "看日志：$DC compose logs -f pb-web" >&2
  exit 1
fi

echo
$DC compose ps
echo
echo "完成。访问 http://<NAS_IP>:$(grep -E '^WEB_PORT=' .env | cut -d= -f2 || echo 3000)"
