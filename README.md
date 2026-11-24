# 个人bookmark

> 把中文互联网的碎片内容，完整、可检索、永久地搬回自己家。

自托管的个人收藏与稍后读工具。针对 **微信公众号 / 小红书 / 抖音** 做了专门适配——这是 Cubox（需付费）和 Karakeep（公众号图片裂）都没解决好的场景。

## 现状

**🚧 Sprint 1 收尾中。** 公众号抓取链路已打通到"能存、能读、能看原图"。

| 已完成 | 待验证 / 待补 |
|---|---|
| 11+2 张表迁移、登录、三栏界面 | 真机端到端（需要 NAS 上有 DB） |
| 公众号 / 通用网页 adapter（36 项断言） | 扩展与「粘贴正文」通道 |
| 图片两档变体（display/thumb，原图不落盘） | 小红书 / 抖音 adapter |
| 阅读页 + 全屏 lightbox + 「预览原图」 | 高亮、搜索、分类规则 |
| 粘贴框保存 + 异步轮询进度 | PWA 安装引导 |

设计与架构决策全部记录在 **[SPEC.md](./SPEC.md)**，动手前请先读它。

## 快速开始

环境要求：Node 22+、pnpm 10+、Docker（只需要里面的 Postgres）。

```bash
cp .env.example .env          # 填 DB_PASSWORD / AUTH_SECRET
pnpm install

docker compose up -d pb-db    # 只起数据库
pnpm db:migrate               # 建表 + 扩展 + 索引
pnpm dev                      # web(:3000) + worker
```

首启的 `pb-web` 日志会打印随机生成的管理员密码。**打开登录页时就会生成**，所以先访问一次页面再看日志：

```bash
# 本地直接看终端；容器里用
docker compose logs pb-web | tail -30
```

不想翻日志？在 `.env` 里设 `ADMIN_PASSWORD=你的密码` 即可（只在 `data/config/auth.json` 不存在时生效）。

忘记密码：删掉 `data/config/auth.json` 重启即可重新生成。

验证接口：

```bash
curl -s localhost:3000/api/v1/health          # {"ok":true,"db":true,...}
# 在 /settings 建一个 PAT 之后
curl -s localhost:3000/api/v1/items -H "Authorization: Bearer pb_xxx"
```

`pnpm --filter @pb/core check` 跑 URL 规范化自检（19 项）。
`pnpm check:compose` 静态校验 compose 与 Dockerfile（语法、服务、target、环境变量对齐）。

## 为什么再造一个

| 维度 | Cubox | Karakeep | 本项目 |
|---|---|---|---|
| 公众号正文 | ✅ | ❌ 图片裂 | ✅ |
| 公众号图片 | ✅ | ❌ 防盗链 + 懒加载 | ✅ 强制本地化 |
| 费用 | 会员制 | 免费 | 全功能免费 |
| 数据主权 | ❌ 云端 | ✅ | ✅ 全本地 |

Karakeep 的问题很具体：公众号图片用 `data-src` 懒加载且 `mmbiz.qpic.cn` 有 Referer 防盗链（[issue #2493](https://github.com/karakeep-app/karakeep/issues/2493)）。本项目从架构上绕开——**采集在客户端做，图片强制落盘**。

## 三条设计铁律

1. **完整快照** — 正文 + 图片全落本地。原文删了也还在。
2. **客户端优先抓取** — 浏览器里文章已经渲染好，抓这个比服务端硬爬稳得多。
3. **正文图片绝不热链** — 只认本地资源。唯一例外是「预览原图」：用户显式点击时才从源站回源，且失败可降级。

## 计划中的能力

- 公众号文章：正文 + 全部图片（压缩图长期保存；点开全屏可按需「预览原图」）
- 小红书 / 抖音：封面 + 文案 + 链接
- 文字 / 图片速记
- 自动分类（规则 → 向量近邻传播 → LLM 建议）+ 手动整理
- 中文全文检索 + 语义检索
- 键盘流 Inbox、划词高亮、PWA、Markdown 导出
- 界面参考 **Cubox**（结构与气质）+ **Karakeep**（信息密度与暗色）：桌面三栏内联阅读、移动端底部 tab、三档主题

## 部署目标

绿联 DXP4800（Intel N100 / 16GB）上的 Docker，3 个容器：

```
pb-web (Next.js)  +  pb-worker (抓取/转码/索引)  +  pb-db (Postgres + pgvector)
```

1 万条目预算：约 **11 GB** 存储（只存压缩图，原图不落盘）、约 1 GB 运行时内存。

## 目录

```
apps/web            Next.js 15 — UI 与 /api/v1（Sprint 0 已就绪）
apps/worker         队列消费者，pg-boss（Sprint 0 骨架，Sprint 1 填处理器）
apps/extension      Chrome MV3 扩展（Sprint 2）
packages/core       URL 规范化（已实现）、adapter / 清洗 / 分词 / embedding（待做）
packages/db         Drizzle schema + 迁移 + 手写 SQL（扩展、函数索引）
packages/contract   zod schema —— 扩展 / iOS / 第三方共用契约
docker/             Dockerfile（web / worker 双 target）、entrypoint
docs/               部署手册、API 文档
data/               运行时数据（gitignore）：db / assets / config
```

## 开发

环境要求：Node 22+、pnpm 10+、Docker。

```bash
cp .env.example .env      # 填入 DB_PASSWORD / AUTH_SECRET
pnpm install
docker compose up -d pb-db
pnpm db:migrate
pnpm dev                  # web + worker
```

首次启动的初始密码会打印在 `pb-web` 日志里。

改 schema 之后：

```bash
pnpm db:generate          # drizzle-kit 从 src/schema.ts 生成 SQL
pnpm db:migrate           # 应用迁移，再跑 sql/*.sql 里的扩展与函数索引
```

## 与 SPEC 的差异

实现时偏离了 SPEC 的地方，记在这里免得后面翻旧账：

| 项 | SPEC 写的 | 实际实现 | 原因 |
|---|---|---|---|
| 密码哈希 | `@node-rs/argon2` | `node:crypto` 的 scrypt | 避免原生依赖；scrypt(N=16384) 对单用户自托管足够，且 Docker 构建更省事 |
| 样式方案 | Tailwind + shadcn/ui | 原生 CSS + Design Tokens | 先把 §9.6 的令牌落地；少一层构建配置，迁移到 Tailwind 时变量名可直接复用 |
| 图标 | `lucide-react` | 手写 SVG（8 个） | 只用到 8 个图标，不值得为它加依赖 |
| 镜像 | web / worker 两个镜像 | 单 Dockerfile 两个 target | 共享 deps/builder 阶段，构建缓存命中更好，仍是两个镜像 |
| `item.cover_asset_id` | 外键 → `asset.id` | 软引用，无外键 | `item ↔ asset` 会成环；资源生命周期已由 `asset.item_id` 的 cascade 管住 |
| 包管理器链接 | 未指定 | `nodeLinker=hoisted` | Next 在 pnpm 隔离链接下解析不到 `styled-jsx`/`@swc/helpers`，Windows 上尤其明显 |
| 迁移方式 | drizzle-kit 一步到位 | 扩展 → drizzle 迁移 → 函数索引 三步 | `vector(512)` 列依赖扩展先存在；表达式 GIN/HNSW 索引 drizzle-kit 生成不了 |
| Worker 运行时 | Node 类型剥离（`--experimental-strip-types`） | `tsx` | 类型剥离不支持无扩展名的相对导入（`import './url'`），而 workspace 包内部全是这种写法；改用 tsx 零改动 |

## 免责声明

本工具仅用于**个人**对自己已可访问内容的归档备份。请遵守目标网站的服务条款，不要用于批量抓取或内容再分发。仓库内不含任何真实文章内容。
