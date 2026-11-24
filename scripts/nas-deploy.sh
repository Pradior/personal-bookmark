#!/bin/sh
# 在 NAS 上更新到最新镜像并重启。
#
#   sh scripts/nas-deploy.sh          # 拉最新镜像
#   FORCE_LOGIN=1 sh scripts/nas-deploy.sh
#
# 做的事：拉镜像 → 重启 → 等 pb-web 变 healthy → 打印状态。
# 前提：目录里已有 docker-compose.yml 和 .env，data/ 已建好。
#
# ⚠ 私有 GHCR 镜像需要先登录一次（见 docs/deploy-ugreen.md）：
#     echo <PAT> | docker login ghcr.io -u <用户名> --password-stdin
set -e

cd "$(dirname "$0")/.." 2>/dev/null || true

# 有的机器 docker 需要 sudo
if docker info >/dev/null 2>&1; then
  DC="docker"
else
  DC="sudo docker"
  echo "（docker 需要 sudo，已自动加上）"
fi

echo "==> 检查环境"
if [ ! -f docker-compose.yml ]; then
  echo "❌ 当前目录没有 docker-compose.yml。请在部署目录里运行本脚本。" >&2
  exit 1
fi
if [ ! -f .env ]; then
  echo "❌ 缺少 .env。先 cp .env.example .env 并填 DB_PASSWORD / AUTH_SECRET" >&2
  exit 1
fi

TAG_VALUE=$(grep -E '^TAG=' .env | cut -d= -f2)
echo "    镜像标签: ${TAG_VALUE:-latest}"

echo "==> 拉取镜像"
if ! $DC compose pull; then
  cat >&2 <<'EOF'
❌ 拉取失败。常见原因：
   1) 镜像是私有的但没登录 —— 执行：
        echo <你的PAT> | docker login ghcr.io -u <GitHub用户名> --password-stdin
      PAT 只需要 read:packages 权限。
   2) 这台机器连不上 ghcr.io —— 需要给 dockerd 配代理。
   3) 镜像还不存在 —— 去 GitHub → Actions 看 images job 是否成功。
EOF
  exit 1
fi

echo "==> 重启"
$DC compose up -d

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
