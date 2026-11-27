# 绿联 DXP4800 部署手册

> 本文是按**实际部署过程**写的，包含真实踩过的坑。机型：绿联 DXP4800（Intel N100 / 16GB），系统 UGOS Pro。

## 0. 前置

| 项 | 说明 |
|---|---|
| Docker | UGOS Pro 应用中心安装「Docker」 |
| SSH | 控制面板 → 终端机 → 启用 SSH（默认 22 端口） |
| 目录 | 建议 `/volume1/docker/personal-bookmark` |
| 端口 | **不要用 80 / 443**（UGOS Web UI 占用）；本文示例用 `3081` |
| 网络 | NAS 能访问 `ghcr.io`（拉镜像用，不需要访问 github.com） |

> 本机 docker 需要 `sudo`。想免 sudo：`sudo usermod -aG docker $USER` 后**重新登录 SSH**。
> 注意这等于给该账号 root 权限，多人共用别这么干。

## 1. 部署（拉镜像，不需要源码）

镜像由 GitHub Actions 在 main 分支上构建好并推到 GHCR，NAS 只负责拉取。
**不需要 git、不需要 docker build，也就不用等十几分钟编译。**

### 1.0 干净重建（可选）

**彻底重来**时先删干净，但想留数据就先备份：

```bash
cd /volume1/docker
# 想保留条目/密码就先备份，否则跳过这行
cp -a personal-bookmark/data /volume1/docker/pb-backup-$(date +%F) 2>/dev/null || true
rm -rf personal-bookmark
mkdir -p personal-bookmark && cd personal-bookmark
```

> ⚠ `data/config/auth.json` 是管理员密码。删了会重新生成（打开登录页后看日志），
> `data/db` 里的条目也会一起没。空库的话无所谓。

### 1.1 准备目录和两个文件

```bash
mkdir -p /volume1/docker/personal-bookmark && cd /volume1/docker/personal-bookmark
```

只需要两个文件：`docker-compose.yml` 和 `.env.example`。

```bash
BASE=https://raw.githubusercontent.com/Pradior/personal-bookmark/main
curl -fsSL -O "$BASE/docker-compose.yml"
curl -fsSL -O "$BASE/.env.example"
```

> 如果仓库是私有的，raw 链接也会要认证。两种办法：
> ① 用带 token 的地址（`https://<PAT>@raw.githubusercontent.com/...`）；
> ② 在电脑上从 GitHub 网页下载这两个文件，用 File Station 拖到 NAS。

然后建数据目录：

```bash
mkdir -p data/{db,assets,config}
```

### 1.2 生成 .env

```bash
cp .env.example .env
```

至少要改三处：

```ini
DB_PASSWORD=<openssl rand -base64 24 的输出>
AUTH_SECRET=<openssl rand -base64 32 的输出>
WEB_PORT=3081
```

生成随机值：

```bash
echo "DB_PASSWORD=$(openssl rand -base64 24)"
echo "AUTH_SECRET=$(openssl rand -base64 32)"
```

没有 openssl 就用 Node：

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

**可选**：不想翻日志找密码，直接指定：

```ini
ADMIN_PASSWORD=你的密码
```

> 懒得手填密钥：如果你有完整仓库，直接 `sh scripts/nas-bootstrap.sh 3081`，
> 它会建好 data 目录并生成带随机密钥的 `.env`（已存在则不覆盖）。
> 没有仓库也没关系 —— 用手动命令生成两个随机值填进去即可。

### 1.3 登录 GHCR（仅私有镜像需要）

```bash
echo <你的PAT> | docker login ghcr.io -u <GitHub用户名> --password-stdin
```

PAT 只需要 `read:packages` 权限（fine-grained token 里勾这个即可）。

> **更省事的做法**：把两个 package 设为公开。
> GitHub → 你的头像 → Your profile → Packages → 依次点开
> `personal-bookmark-web` / `personal-bookmark-worker` →
> Package settings → Danger Zone → Change visibility → Public。
> 设成公开后就不用登录了，`docker compose pull` 直接能拉。
> 公开的只是**镜像**（编译产物），源码仓库仍然是私有的。

### 1.4 启动

```bash
sudo docker compose pull      # 拉镜像（约 300MB，第一次慢）
sudo docker compose up -d
sudo docker compose ps        # 三个容器都 Up，pb-web 应为 healthy
sudo docker compose logs -f pb-web
```

首启会自动跑数据库迁移（扩展 → 表结构 → 函数索引）。

### 1.5 以后更新

```bash
sudo docker compose pull && sudo docker compose up -d
```

> 习惯：先在 GitHub → **Actions** 看一眼那次提交的 `images` job 是绿的，再 pull。
> 那个 job 只有在 verify 全过之后才会跑，所以绿了说明镜像里一定是能跑的代码。

#### 拉不动时：粘这段重试（当前目录只有 compose，没有源码）

镜像部署的目录里**没有 `scripts/`**（那是仓库里的东西）。所以排错用这段内联命令：

```bash
cd /volume1/docker/personal-bookmark
sudo sh -c '
  i=1; d=3
  while [ $i -le 5 ]; do
    echo "==> 第 $i/5 次拉取"
    if docker compose pull pb-web pb-worker && docker compose up -d; then
      echo "==> 完成"; exit 0
    fi
    echo "    失败，${d}s 后重试"
    sleep $d; d=$((d*2)); i=$((i+1))
  done
  echo "==> 5 次都失败：是网络问题，不是镜像问题"
  exit 1
'
```

先单独判断网络（这一步能立刻区分"连不上"和"镜像不存在"）：

```bash
curl -sS -o /dev/null -w 'ghcr 状态码 %{http_code}\n' --max-time 10 https://ghcr.io/v2/ \
  || echo '连不上 ghcr.io'
```

想把它留成文件，下次直接用：

```bash
cd /volume1/docker/personal-bookmark
cat > pull-retry.sh <<'EOF'
#!/bin/sh
i=1; d=3
while [ $i -le 5 ]; do
  echo "==> 第 $i/5 次拉取"
  if docker compose pull pb-web pb-worker && docker compose up -d; then
    echo "==> 完成"; exit 0
  fi
  echo "    失败，${d}s 后重试"; sleep $d; d=$((d*2)); i=$((i+1))
done
echo "==> 5 次都失败：是网络问题，不是镜像问题"; exit 1
EOF
chmod +x pull-retry.sh
# 以后：sudo ./pull-retry.sh
```

仍然失败的三种出路（详见 §7 排错对照表）：

```bash
# ① 给 dockerd 配代理（同网段有能翻墙的机器时最有效）
# ② .env 里改 IMAGE_REPO 指向能连上的镜像源
# ③ 先用本地已有镜像，不阻塞使用：
sudo docker compose up -d --pull never
```

### 1.6 可选：启用无头浏览器（抓 JS 渲染的页面）

有些站点的正文是**前端渲染**的，服务端拿到的 HTML 只是空壳：
微信部分文章（31KB、0 个 `<img>`、带 `vite-legacy` 标记）、小红书整站。

内置一个 Chromium 容器就能解决——worker 在普通抓取失败时会请求它渲染，
拿到执行过 JS 的 DOM 后再走原来的解析流程。

```bash
cd /volume1/docker/personal-bookmark

# 1) 启动浏览器容器（它用 profile 隔离，不加 profile 不会被启动）
sudo docker compose --profile browser up -d

# 2) 让 worker 知道它的地址
echo 'BROWSER_URL=http://pb-browser:3001' >> .env
sudo docker compose up -d pb-worker
```

验证：

```bash
sudo docker compose --profile browser exec pb-browser \
  node -e "fetch('http://127.0.0.1:3001/health').then(r=>r.json()).then(console.log)"
# 期望 { ok: true, browser: 'idle', active: 0 }
```

之后抓取失败时，worker 日志会多一条：

```
[capture] 普通抓取失败，改用无头浏览器渲染 https://mp.weixin.qq.com/s/...
[capture] 浏览器渲染后解析成功：2845173B → 6 张图
```

| 项 | 说明 |
|---|---|
| 镜像体积 | 约 400MB（Debian chromium + 中文字体） |
| 内存 | 每次渲染 300–500MB；`shm_size: 512mb` 必须保留，否则 Chromium 会崩 |
| 速度 | 每篇多 2–5 秒（只有普通抓取失败才会用） |
| 熔断 | 连续失败 3 次后暂停 5 分钟，避免每条抓取都白等 |
| 不启用 | `BROWSER_URL` 留空即可，行为与以前完全一致 |

> 站点可能识别 `navigator.webdriver`。我们已经加了
> `--disable-blink-features=AutomationControlled` 和真实 UA，
> 但不是万能的——真被拦时仍会退回「仅保存链接」，这时用浏览器扩展。
## 2. 拿管理员密码

**打开一次登录页**，然后：

```bash
sudo docker compose logs pb-web | tail -30
```

会看到：

```
[pb] 已生成初始管理员密码（只显示这一次）：

            xxxxxxxxxxxx
```

> 密码是在**登录页被访问时**生成的，不是进程启动时（原因见 SPEC §10.4）。
> 若设置了 `ADMIN_PASSWORD`，日志会显示「已使用 .env 中的 ADMIN_PASSWORD」。

然后浏览器打开 `http://NAS_IP:3081` 登录。

## 3. 验证链路

设置页建一个 PAT，然后：

```bash
# 注意端口是 WEB_PORT，不是容器内的 3000
curl -sS http://127.0.0.1:3081/api/v1/items \
     -H "Authorization: Bearer pb_你的令牌"; echo
```

期望 `{"items":[],"nextCursor":null}`。

拿不准端口时，直接进容器里跑最稳：

```bash
sudo docker compose exec pb-web node -e "fetch('http://127.0.0.1:3000/api/v1/health').then(async r=>{console.log(r.status, await r.text())})"
```

## 4. HTTPS（PWA 安装需要）

「添加到主屏幕」和 Service Worker 都要求 secure context，`http://192.168.x.x` 不行。

| 方案 | 说明 |
|---|---|
| **Tailscale（推荐）** | 免费 `*.ts.net` 域名、不暴露公网、证书零配置 |
| Caddy 容器 + 域名 | 需要域名与 DNS |
| UGOS 自带反代 | 视固件版本，能力有限 |

配好后把 `.env` 的 `PUBLIC_BASE_URL` 改成实际 `https://` 地址并 `sudo docker compose up -d`。

## 5. 备份

```bash
# 数据库必须 pg_dump，不能热备 data/db 目录
sudo docker compose exec -T pb-db pg_dump -U bookmark -Fc bookmark \
  > backup/db-$(date +%F).dump
tar czf backup/assets-$(date +%F).tar.gz -C data assets
```

也可以让 Hyper Backup 直接备份整个项目目录（先跑上面的 dump）。

## 6. 常用命令

```bash
sudo docker compose logs -f pb-worker     # 抓取任务日志
sudo docker compose restart pb-web        # 改了 .env 后
sudo docker compose up -d --build         # 改了代码后
sudo docker compose down                  # 停止（保留数据）
```

## 7. 排错对照表

| 现象 | 原因 | 处理 |
|---|---|---|
| `permission denied ... docker.sock` | 命令没带 `sudo` | 加 `sudo`，或把用户加进 docker 组 |
| `curl: (7) Failed to connect to 127.0.0.1 port 3000` | 端口不是 3000 | `sudo docker compose ps` 看 `PORTS` 列左侧的真实宿主端口 |
| 日志里找不到密码 | 还没人访问过登录页 | 打开一次 `/login` 再看日志；或设 `ADMIN_PASSWORD` |
| 打开页面提示要登录，但密码忘了 | 密码存在 `data/config/auth.json` | 删掉该文件重启，会重新生成 |
| 卡片显示「触发人机验证」 | 该 IP 抓公众号被拦 | 见下节 |
| 卡片一直「正在抓取」 | worker 异常 | `sudo docker compose logs pb-worker` |
| `pb-web` 反复重启 | 迁移失败 | 看日志里 migrate 的输出，确认 `DATABASE_URL` 与 pb-db 健康 |
| `pull` 报 `registry-1.docker.io`: EOF | Docker Hub 连不上（pb-db 镜像来自那里） | 只拉应用镜像：`docker compose pull pb-web pb-worker`；或在 UGOS Docker → 设置 → 加速器 配镜像源。compose 里 `pb-db` 已设 `pull_policy: missing`，正常情况下不会再碰它 |
| `pull` 报 `ghcr.io/v2`: TLS handshake timeout | NAS 连不上 GitHub Container Registry（间歇性封锁，与镜像无关——CI 一直在推） | 见 §1.5 的「拉不动时」：内联重试脚本（不需要源码），先 `curl https://ghcr.io/v2/` 确认是网络问题。仍失败见下一行 |
| 重试多次仍拉不下来 | 该时段网络彻底不通 | 三条路，按成本排序：① 给 NAS 配代理（见下方 dockerd 配置）；② 改 `.env` 里的 `IMAGE_REPO` 指向可用镜像源；③ 先用本地已有镜像 `docker compose up -d --pull never` 不阻塞使用 |

**dockerd 走局域网代理**（如果同一网段有一台能翻墙的机器）：

```bash
sudo mkdir -p /etc/systemd/system/docker.service.d
sudo tee /etc/systemd/system/docker.service.d/proxy.conf >/dev/null <<'EOF'
[Service]
Environment="HTTP_PROXY=http://192.168.x.x:7897"
Environment="HTTPS_PROXY=http://192.168.x.x:7897"
Environment="NO_PROXY=localhost,127.0.0.1,pb-db,pb-web,pb-worker"
EOF
sudo systemctl daemon-reload && sudo systemctl restart docker
```

**改镜像源不需要动 compose**：`IMAGE_REPO` 已经是变量。

```bash
# .env
IMAGE_REPO=ghcr.io/pradior        # 默认
IMAGE_REPO=<镜像源域名>/pradior    # 换成能连上的反代
```


### 关于公众号抓取被拦

实测：**非住宅 IP（云服务器、部分机房）会被重定向到 `wappoc_appmsgcaptcha` 验证页**，
HTTP 状态仍是 200。家用宽带的 NAS 通常不受影响。

判断方法：

```bash
URL='https://mp.weixin.qq.com/s/真实链接'
curl -s -o /dev/null -w '%{http_code} %{url_effective}\n' -L \
  -H 'User-Agent: Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.44' \
  -H 'Referer: https://mp.weixin.qq.com/' \
  "$URL"
```

输出 URL 里出现 `wappoc_appmsgcaptcha` 即为被拦。

## 8. 文件权限（可选）

默认容器以 root 运行，`data/` 下文件属主是 root。想让 NAS 账号可读写：

```bash
id                                     # 记下 uid:gid，绿联常见 1000:1000
sudo chown -R 1000:1000 data
```

然后在 `docker-compose.yml` 给 `pb-web` / `pb-worker` 各加一行：

```yaml
    user: "1000:1000"
```

> 别一上来就加：PUID 填错容器会起不来，且报错很不直观。先跑通再改。

## 9. 备选：从源码构建

不想依赖 GHCR（比如仓库要长期私有、或想改代码立刻生效）时用这条路。
需要 NAS 能访问 github.com。

```bash
cd /volume1/docker
git clone https://github.com/Pradior/personal-bookmark.git
cd personal-bookmark
cp .env.example .env && vi .env
mkdir -p data/{db,assets,config}
sudo docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

`docker-compose.build.yml` 是 override 文件，它给 web/worker 补上 `build:` 段，
并把 `pull_policy` 从 `always` 改成 `build`（否则会先白拉一次远端镜像）。

以后更新：

```bash
git pull && sudo docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

**代价**：N100 上每次全量构建 10–20 分钟（依赖层有缓存时会快很多）。
**好处**：不依赖 GHCR；改一行代码就能立刻生效，适合调抓取规则。

### 仓库私有时 clone 需要凭据

GitHub 已不支持密码认证，用 PAT：

```bash
git clone https://<PAT>@github.com/Pradior/personal-bookmark.git
cd personal-bookmark
# 别把 token 留在配置里
git remote set-url origin https://github.com/Pradior/personal-bookmark.git
```

**NAS 访问不了 github.com 时**：给 git 配代理
（`git config --global http.proxy http://<代理地址>:7897`，代理需允许局域网连接），
或者在有网的电脑上 clone 后整个目录拷到 NAS（`.git` 一起拷，之后仍能 pull）。