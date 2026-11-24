# 绿联 DXP4800 部署手册

> 本文是按**实际部署过程**写的，包含真实踩过的坑。机型：绿联 DXP4800（Intel N100 / 16GB），系统 UGOS Pro。

## 0. 前置

| 项 | 说明 |
|---|---|
| Docker | UGOS Pro 应用中心安装「Docker」 |
| SSH | 控制面板 → 终端机 → 启用 SSH（默认 22 端口） |
| 目录 | 建议 `/volume1/docker/personal-bookmark` |
| 端口 | **不要用 80 / 443**（UGOS Web UI 占用）；本文示例用 `3081` |
| Git | 从 GitHub 部署需要 NAS 能访问 github.com |

> 本机 docker 需要 `sudo`。想免 sudo：`sudo usermod -aG docker $USER` 后**重新登录 SSH**。
> 注意这等于给该账号 root 权限，多人共用别这么干。

## 1. 从 GitHub 部署

```bash
cd /volume1/docker
git clone https://github.com/Pradior/personal-bookmark.git
cd personal-bookmark
```

> **NAS 访问不了 github.com 时**（国内网络常见）：给 git 配代理，
> 例如 `git config --global http.proxy http://<代理地址>:7897`；
> 或者在有网的机器上 clone 后整个目录拷到 NAS（`.git` 一起拷，之后仍能 pull）。

### 1.1 建数据目录

```bash
mkdir -p data/{db,assets,config}
```

### 1.2 配置 .env

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

### 1.3 启动

```bash
sudo docker compose up -d --build     # 首次构建镜像，N100 上约 10–20 分钟
sudo docker compose ps                # 三个容器都 Up，pb-web 应为 healthy
sudo docker compose logs -f pb-web    # 看启动日志
```

首启会自动跑数据库迁移（扩展 → 表结构 → 函数索引）。

### 1.4 以后更新

```bash
sh scripts/nas-deploy.sh
```

脚本会：拉最新代码 → 重建镜像 → 等 `pb-web` 变 healthy → 打印状态。
等价于手动执行 `git pull && docker compose up -d --build`。

> 习惯：先在 GitHub → **Actions** 看一眼那次提交是绿的，再在 NAS 上更新。
> CI 跑的就是类型检查 + 三套自检 + 构建，绿了说明不会白等十几分钟。

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
