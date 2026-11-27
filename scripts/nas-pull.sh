#!/bin/sh
# 在 NAS 上拉取镜像——带重试、诊断与镜像源切换提示
#
#   sudo sh scripts/nas-pull.sh
#
# ⚠️ 这个文件在**仓库**里。如果你的部署目录只有 docker-compose.yml + .env
#    （镜像部署，没 clone 源码），用 docs/deploy-ugreen.md §1.5 里那段内联命令。
#
# 为什么需要它：ghcr.io 在国内经常间歇性 TLS handshake timeout。
# 单次 `docker compose pull` 失败后往往只是"这次运气不好"，
# 但它不会告诉你到底是网络问题还是镜像不存在，也不知道该重试几次。
set -u

REPO="${IMAGE_REPO:-ghcr.io/pradior}"
TAG="${TAG:-latest}"
SERVICES="pb-web pb-worker"
RETRIES="${RETRIES:-5}"

# ── 1) 先判断 ghcr.io 通不通 ──────────────────────────────
# 用参数展开取域名，而不是 `sed -E`：NAS 上是 busybox，不保证支持 -E
REGISTRY="${REPO%%/*}"
echo "==> 目标镜像源：$REGISTRY"
echo "==> 检查 HTTPS 连通性…"

if command -v curl >/dev/null 2>&1; then
  if curl -sS -o /dev/null --max-time 12 "https://$REGISTRY/v2/"; then
    echo "    ✓ $REGISTRY 可达"
  else
    echo "    ✗ $REGISTRY 连不上（TLS 握手失败或超时）"
    echo
    echo "    这不是镜像的问题，是网络。按顺序试："
    echo "      1) 直接重跑本脚本（间歇性封锁，重试常常就通了）"
    echo "      2) 给 NAS 配 HTTPS 代理，见下面的 dockerd 配置"
    echo "      3) 改用镜像源：在 .env 里改 IMAGE_REPO"
    echo
    echo "    dockerd 走代理（如果局域网里有一台能翻墙的机器）："
    echo "      sudo mkdir -p /etc/systemd/system/docker.service.d"
    echo "      写入 /etc/systemd/system/docker.service.d/proxy.conf："
    echo "        [Service]"
    echo "        Environment=\"HTTPS_PROXY=http://<代理IP>:7897\""
    echo "        Environment=\"HTTP_PROXY=http://<代理IP>:7897\""
    echo "      sudo systemctl daemon-reload && sudo systemctl restart docker"
    echo
    echo "    改用镜像源（只改 .env，不用动 compose）："
    echo "      IMAGE_REPO=ghcr.io/pradior              # 默认"
    echo "      IMAGE_REPO=<你的镜像源>/pradior          # 例：某个 ghcr 反代"
    echo
    echo "    仍然失败就退回本地已有镜像："
    echo "      sudo docker compose up -d --pull never"
    exit 1
  fi
fi

# ── 2) 带退避重试 ────────────────────────────────────────
attempt=1
delay=3
while [ "$attempt" -le "$RETRIES" ]; do
  echo
  echo "==> 第 $attempt/$RETRIES 次拉取 $REPO/{web,worker}:$TAG"
  if sudo docker compose pull $SERVICES; then
    echo
    echo "==> 拉取成功，重建容器…"
    sudo docker compose up -d
    echo
    echo "==> 完成。镜像时间："
    sudo docker image inspect "$REPO/personal-bookmark-web:$TAG" \
      --format '    web    {{.Created}}' 2>/dev/null || true
    sudo docker image inspect "$REPO/personal-bookmark-worker:$TAG" \
      --format '    worker {{.Created}}' 2>/dev/null || true
    exit 0
  fi

  attempt=$((attempt + 1))
  if [ "$attempt" -le "$RETRIES" ]; then
    echo "    第 $((attempt - 1)) 次失败，${delay}s 后重试…"
    sleep "$delay"
    delay=$((delay * 2))
  fi
done

echo
echo "==> $RETRIES 次都失败了。"
echo "    镜像本身是好的（CI 一直在推），问题在网络。"
echo "    可以先用已有镜像启动，不阻塞使用："
echo "      sudo docker compose up -d --pull never"
exit 1
