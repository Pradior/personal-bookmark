# 个人bookmark — 设计规格书 (SPEC)

| 项 | 值 |
|---|---|
| 文档版本 | v0.1 (草案) |
| 日期 | 2026-11-23 |
| 状态 | 待评审 → 转实现 |
| 目标平台 | 绿联 DXP4800 (Intel N100 / 16GB) + Docker |
| 客户端 | Chrome/Edge 扩展、PWA (iPhone/iPad)、REST API |
| 规模目标 | 1 万条目 / 单用户 |

---

## 目录

1. [产品定义](#1-产品定义)
2. [架构决策记录 (ADR)](#2-架构决策记录-adr)
3. [系统架构](#3-系统架构)
4. [数据模型](#4-数据模型)
5. [API 契约](#5-api-契约)
6. [Adapter 规范](#6-adapter-规范)
7. [分类系统](#7-分类系统)
8. [阅读与检索](#8-阅读与检索)
9. [界面与交互](#9-界面与交互)
10. [部署](#10-部署)
11. [M0 任务拆分](#11-m0-任务拆分)
12. [容量与性能预算](#12-容量与性能预算)
13. [风险登记册](#13-风险登记册)
14. [后续路线 (M1–M3)](#14-后续路线-m1m3)
15. [开放问题](#15-开放问题)

---

## 1. 产品定义

### 1.1 一句话

> 把中文互联网的碎片内容，**完整、可检索、永久地**搬回自己家。

### 1.2 三个支柱

| 支柱 | 含义 | 不可妥协的理由 |
|---|---|---|
| **完整快照** | 正文 + 图片 + 元信息全部落本地 | 公众号会删文、小红书会限流、抖音会下架。只存 URL 等于没存 |
| **中文可检索** | 全文 + 语义搜索，三年后还能翻出来 | 存了找不到 = 没存 |
| **采集无摩擦** | 手机端 3 秒存完 | 顺手才会长期用，这是 Cubox 真正的护城河 |

### 1.3 三个核心场景（M0 必须全部覆盖）

| # | 场景 | 期望路径 | M0 验收 |
|---|---|---|---|
| S1 | 微信公众号文章记录，后续查看 | 桌面：扩展一键 / 手机：复制链接→粘贴 | 正文完整、**图片全部显示** |
| S2 | 小红书 / 抖音链接后续查看 | 扩展读页面数据；服务端兜底元信息 | 标题+作者+封面+文案，链接可回原站 |
| S3 | 文字 / 图片临时存放 | 粘贴框直接写；拖图上传 | 富文本 + 图片，无标题也能存 |

### 1.4 明确的非目标 (Non-Goals)

写下来是为了将来不被"顺手加个功能"拖死。

- ❌ **不是 RSS 阅读器**。不做公众号自动订阅抓取（那是另一个项目，且合规风险更高）
- ❌ **M0–M2 不做多用户 / 分享 / 协作**
- ❌ **不做社交**：无点赞、无评论、无发现页
- ❌ **不代理浏览**：不提供"在线阅读原站"的翻墙式代理
- ❌ **不碰登录态批量爬取**：绝不注入微信 Cookie 做批量抓取（见 ADR-001 与 13.1）
- ❌ **不做原生 App 直到 M3**：M0–M2 用 PWA，但 API 从第一天就按"对外 API"设计（ADR-009）

### 1.5 与 Cubox / Karakeep 的差异

| 维度 | Cubox | Karakeep | 本项目 |
|---|---|---|---|
| 公众号正文 | ✅ 完整 | ❌ 图片裂（[issue #2493](https://github.com/karakeep-app/karakeep/issues/2493)） | ✅ 客户端优先抓取 + 图片落盘 |
| 公众号图片 | ✅ | ❌ 防盗链 + 懒加载 | ✅ 强制本地化 |
| 小红书/抖音 | 部分 | 弱 | 专有 adapter |
| 费用 | 会员制 | 免费自托管 | 全功能免费自托管 |
| 数据主权 | ❌ 云端 | ✅ | ✅ 全本地，可导出 Markdown |
| 语言/检索 | 中文优先 | 英文视角 | 中文分词 + 语义检索 |

---

## 2. 架构决策记录 (ADR)

> 每条都记录**否决了什么**，避免将来重新纠结。

### ADR-001｜采集：客户端优先，服务端兜底

**背景**：公众号正文图片用 `data-src` 懒加载，且 `mmbiz.qpic.cn` 有 Referer 防盗链。服务端没有登录态、没有微信内 UA 环境。

**决策**：能客户端抓的绝不在服务端抓。采集分三档能力（见 §5.3），服务端按收到的完整度自动降级。

**理由**：
- 浏览器里文章**已经渲染好**——`data-src` 已替换、图片已加载、小红书 `__INITIAL_STATE__` 就在内存里
- 客户端抓图不受 CORS 约束（扩展 Service Worker 有 host permission）
- 服务端抓取永远追不上风控变化，客户端天然免疫

**实证（2026-11-24，Sprint 1 联调）**：从非住宅 IP 抓公众号，会被 302 到
`/mp/wappoc_appmsgcaptcha?poc_token=...&target_url=...`，HTTP 状态仍是 200，
但 HTML 里只有一段跳验证的 JS（检测信号：`完成验证`、`环境异常`、`wappoc_appmsgcaptcha`）。
**即服务端抓取在部分网络环境下对公众号完全不可用**——这不再是"优化"，而是必须。

因此：`detectBlock()` 会识别这种情况并抛 `FetchError('blocked')`，
上层据此提示用户"请在浏览器里打开后用扩展/粘贴正文保存"，而不是含糊报"解析失败"。
`captureWithFallback` 遇到 `blocked` 不会再去试 generic（同一个 IP 必然同样被拦）。

**否决的替代方案**：
- 纯服务端抓取（Karakeep 路线）→ 公众号必然裂图，且可能直接被验证码拦死
- 注入 Cookie 的模拟客户端 → 有封号风险，且 cookie 会过期，维护成本无底洞
- 无头浏览器 → 同样过不了验证码交互，只是更慢

**后果**：必须维护一个浏览器扩展。这是成本，也是护城河。

---

### ADR-002｜图片必须本地化，禁止热链

**背景**：`mmbiz.qpic.cn`、`sns-webpic-qc.xhscdn.com`、抖音 CDN 全部有 Referer 防盗链。若在自己的域名下直接 `<img src="https://mmbiz...">`，浏览器会带**本项目域名**作 Referer → 403 → 裂图。

**决策**：
- 所有远程图片在采集时下载、转码、落盘
- 数据库 `asset` 表分离 `origin_url`（源地址）与存储 key（渲染依据）
- 渲染层**只**使用 `/api/v1/assets/:id` 同源地址
- **只存压缩图**（thumb + display），原图不落盘，按需回源（见 ADR-013）
- `origin_url` 是「预览原图」的唯一取数来源，必须完整入库；但渲染层仍不直接使用它

**否决的替代方案**：
- 图片代理（`/proxy?url=...` 带 Referer 转发）→ 若把**正文渲染**也走代理，就依赖原站图片存活，公众号删文后图全丢，违背"完整快照"支柱。注意：ADR-013 的按需回源只用于"看原图"这一可降级场景，正文永远走本地
- 前端 `referrerpolicy="no-referrer"` 绕过 → 部分站点可用，但微信图需要**指定** Referer 而非空 Referer，且仍有跨域与存活问题

**后果**：存储占用约 10GB（1 万条目，仅压缩图），换来真正的归档价值 + 按需看原图的能力。

---

### ADR-003｜M0 不使用无头浏览器

**背景**：N100 有 16GB 内存，跑 Chromium 技术上可行。

**决策**：M0 的抓取栈 = `undici` (HTTP) + `cheerio` (选择器解析) + `jsdom + @mozilla/readability` (通用网页抽取)。Playwright 作为**可选 compose profile**，默认不启动。

**理由**：
- 公众号静态 HTML 里 `data-src` **本来就存在**，不需要 JS 渲染
- Chromium 常驻 300–500MB，N100 单页渲染 3–8s，性价比极低
- 少一个容器 = 少一堆升级和内存问题

**后果**：小红书深链等动态页在 M0 只能拿到元信息（`<meta og:*>`）；需要完整内容时依赖扩展。

---

### ADR-004｜Postgres，不用 SQLite

**背景**：单用户 1 万条，SQLite 看着够用。

**决策**：Postgres 16 + `pgvector`，跑在容器里。

**理由**：
- 中文全文检索：SQLite FTS5 默认 tokenizer 对中文几乎不可用
- 需要 `pgvector`（语义搜索 + 标签传播）
- 需要 `pg-boss`（任务队列，见 ADR-006）
- 多进程并发写（web + worker）下 SQLite 的 WAL 锁会难受

**否决的替代方案**：SQLite + FTS5 trigram —— MVP 更快，但 M2 做语义检索时必然迁移，不如一次到位。

---

### ADR-005｜零 Postgres 扩展做中文检索

**背景**：中文 FTS 常见方案是 `zhparser`（SCWS 分词），但它需要编译 Postgres 扩展，**每次升级镜像都会炸**。

**决策**：应用层预分词 + `simple` 配置 + `pg_trgm` 兜底。

```
写入：@node-rs/jieba 分词 → item.search_text = "微信 文章 收藏 阅读 体验"
索引：CREATE INDEX ... USING gin (to_tsvector('simple', search_text))
查询：plainto_tsquery('simple', jieba.cut(查询词).join(' '))
模糊：CREATE EXTENSION pg_trgm → GIN (title gin_trgm_ops)
```

**理由**：
- `@node-rs/jieba` 是 Rust/N-API 绑定，**提供预编译二进制**，Docker 里免 node-gyp
- `pg_trgm` 在官方 `postgres` 镜像里自带，一条 `CREATE EXTENSION` 搞定
- 分词策略完全掌握在自己手里，可以加自定义词典（比如你的标签名、常看的公众号名）

**否决的替代方案**：
- `zhparser` → 编译地狱
- `pg_bigm` → 不在官方镜像，同样要装
- Meilisearch → 多一个容器 + 数据同步双写，1 万条规模不值得
- `pgroonga` → 强，但镜像重、维护复杂

**后果**：分词规则变更需重建索引。1 万条重建约 10 秒，可忽略。

---

### ADR-006｜pg-boss 而非 Redis

**决策**：用 `pg-boss`（任务表跑在同一个 Postgres 里）替代 BullMQ + Redis。

**理由**：少一个容器，少一份内存，少一个要备份的东西。1 万条规模的任务吞吐，pg-boss 绰绰有余。

**否决的替代方案**：BullMQ + Redis → 40–80MB 内存 + 一个额外的持久化卷，收益为零。

**后果**：任务延迟比 Redis 高（轮询间隔，默认可调到 500ms 级）。对"点保存，30 秒内看到结果"完全够。

---

### ADR-007｜Adapter 插件化，核心不感知平台

**决策**：核心代码里**不出现**"微信"、"小红书"这些字符串。平台差异全部收敛到 `packages/core/adapters/*`。

```ts
interface Adapter {
  id: string;                    // 'wechat' | 'xhs' | 'douyin' | 'generic'
  priority: number;
  match(url: URL): boolean;
  capture(ctx: CaptureContext): Promise<CaptureResult>;
}
```

**理由**：开源后加平台 = 扔一个文件进去。否则每加一个平台都要动核心。

**后果**：`CaptureResult` 契约必须设计得足够通用（见 §6.2）。

---

### ADR-008｜品牌名与代码解耦

**背景**：项目名未定。

**决策**：
- npm scope 用中性名 `@pb/*`
- 容器名 `pb-web` / `pb-worker` / `pb-db`
- UI 显示名一律读 `APP_NAME` 环境变量
- 代码里零个中文字面品牌名

**后果**：将来定名 = 改 `.env` 一处 + 全局替换 scope，约 1 个 PR。

---

### ADR-009｜API-first，为未来 iOS 原生客户端铺路

**背景**：用户主力设备是 iPhone/iPad，明确考虑后期做 iOS App。

**决策**：
- 所有能力暴露为 `/api/v1/*` REST 接口
- 认证用 **Bearer PAT**（个人访问令牌），页面用 HttpOnly session cookie
- 请求/响应 schema 定义在 `packages/contract`（zod），由它生成 OpenAPI
- 扩展、快捷指令、未来 Swift 客户端都是**同一批公开端点**的消费者，不走内部后门

**否决的替代方案**：先用 server actions 图快 → 扩展和 iOS 立刻卡住，后期重构成本远高于提前抽象。

**后果**：多写一层 zod schema。值得。

---

### ADR-010｜本地向量 + 云端 LLM

**背景**：用户有 DeepSeek API。

**决策**：
- **Embedding：本地 ONNX** `bge-small-zh-v1.5`（int8 量化，~30MB），512 维
- **摘要/打标：DeepSeek `deepseek-chat`**（OpenAI 兼容）
- 二者经 `Embedder` / `LlmProvider` 两个接口抽象，可替换为 Ollama / OpenAI / 关闭

**理由**：**DeepSeek 目前没有 embedding 接口**。所以向量必须本地跑。而 N100 有 AVX2，ONNX 推理 30–60ms/篇，1 万篇全量约 10 分钟——完全可接受。

**隐私开关**：集合级 `ai_enabled=false`，该集合内容不送云端，只走 L1 规则 + L2 向量传播。

---

### ADR-011｜集合单归属 + 标签多归属

**决策**：`collection`（树，单归属，回答"这是什么"）+ `tag`（多对多，回答"我为什么存"）两套并存，不合并。

**理由**：合并成一套必然二选一时痛苦：文件夹丢失层级，纯标签丢失"唯一位置"的踏实感。Cubox 用两者并存是对的。

---

### ADR-012｜双存：清洗后内容 + 原始快照

**决策**：
- `item.content_html` = 清洗后、图片已改写的 HTML（渲染用）
- `snapshot.raw_gz` = 原始 HTML/JSON 的 gz 快照（解析器升级后可重跑）

**理由**：公众号删文后，原始快照是唯一的重解析来源；而渲染又必须用清洗后的版本。两者用途不同，不能只存一个。

---

### ADR-013｜只存压缩图，原图按需回源

**背景**：用户要求「所有存储以压缩图为准；压缩图看不清时，点开全屏，下侧有『预览原图』，按下才下载原图」。

**决策**：**永久只存两档派生图，不保存原始字节。** 原图不入库，仅在用户显式点击时从源站按需拉取。

| 落盘 | 规格 | 用途 | 何时加载 |
|---|---|---|---|
| `thumb` | webp，长边 400，q=75 | 列表卡片封面、正文占位 | 首屏 / 进入视口前 |
| `display` | webp，长边 ≤2000，q=85 | 正文内联、全屏查看 | 进入视口时 |
| ~~`original`~~ | **不落盘** | 「预览原图」时临时回源 | 用户点击「预览原图」 |

**关键设计后果：`origin_url` 从溯源字段变成功能字段。**

ADR-002 原本规定 `origin_url` 仅供溯源、渲染层不使用。现在它是「预览原图」的**唯一取数来源**，必须当作一等公民对待：

- 采集时**必须**把 `origin_url` + `origin_referer`（+ 必要的 UA）完整入库，否则该图的「预览原图」永久失效
- 渲染层**仍然**不用它——只有 `GET /api/v1/assets/:id/source` 这个端点在服务端用它回源
- 若某 adapter 拿不到源地址（例如扩展送来的是已上传的 blob、没有 origin），要显式标记 `asset.source_available = false`，UI 直接隐藏「预览原图」按钮

**数据结构**：

```
asset           (id, sha256, mime, width, height, source_bytes,
                 origin_url, origin_referer, source_available, ...)
  └─ asset_variant (id, asset_id, variant, storage_key, mime, bytes, width, height)
                   variant ∈ {thumb, display}
```

- `asset.sha256` = **源文件字节**的哈希，在下载瞬间算出，用于跨条目去重和缓存键；文件本身随即丢弃
- `asset.source_bytes` = 源文件大小，用于全屏预览时提前告知"原图约 2.4MB"（不下载也能显示）
- `asset_variant` 只允许 `thumb` / `display` 两种值，schema 层用枚举卡死，防止有人偷偷写回 original

**为什么 `display` 的参数调高了**：既然它成了唯一长期副本，就不能再心疼体积。

| 参数 | 旧值 | 新值 | 理由 |
|---|---|---|---|
| 长边 | 1600 | **2000** | 文字截图 1600 宽经常糊，2000 是可读性拐点 |
| 质量 | q80 | **q85** | 唯一副本，宁可多 30% 体积 |

代价：单张 ~80KB → ~150KB，1 万条的 assets 从 5.7GB 涨到 ~10GB。相比保留原图的 20.7GB，仍省一半以上，而手机上的可读性明显改善。

**例外规则**：

| 情况 | 处理 |
|---|---|
| **GIF / 动图** | 不转码，`display` 直接存原始字节（这是唯一需要留原文件的例外——转码会丢帧） |
| SVG | 不转码，原样保存，渲染时剥 `<script>` |
| 用户上传的截图 | `display` **必须剥离 EXIF**（含 GPS） |
| 非图片（PDF / 视频） | 见 [Q4]，M0 不做，M1 单独定策略 |

**「预览原图」的交互**（用户明确要求，照此实现）：

```
正文图片点击 → 全屏 lightbox（遮罩层，不跳页）
   下侧工具条：[ 预览原图 ]   ← 唯一的原图入口
   按下后：
     ① 显示"正在获取原图… 约 2.4MB"
     ② GET /api/v1/assets/:id/source  → 服务端带 origin_referer 回源
     ③ 成功 → 原地替换为原图（可双指放大 / 滚轮缩放）
     ④ 失败 → 保留压缩图 + 明确提示"原图已不可获取（原文可能已删除）"
   关闭 → 点遮罩 / Esc / 下滑
```

- 只在按下时**才**发起网络请求。不进视口不请求，不预取，不在后台偷偷拉
- 手机上长按图片可调用系统「存储图像」（浏览器原生行为，不额外实现）
- 显示原图时给一个角标：`原图 1080×1440 · 2.4MB`

**回源的失败是常态，必须当成正常路径设计**：

公众号删文、小红书限流、图片 CDN 过期，都会让 `origin_url` 变死。这时：

1. 压缩图还在（这是我们长期保存的东西），阅读不受影响
2. UI 明确说「原图已不可获取」，而不是转圈或报错
3. 记录 `asset.source_status = 'failed'` + `source_checked_at`，之后**不再重复尝试**（可选做一次 7 天后重试）
4. 这也意味着：**「预览原图」是尽力而为，不是承诺。** 这点要在 UI 文案里诚实体现

**服务端回源的安全约束**（`GET /assets/:id/source`）：

| 项 | 约束 |
|---|---|
| 协议 | 仅 `http:` / `https:`，其它一律拒 |
| SSRF | 解析目标 IP，拒绝私有网段 / 回环 / 链路本地 / `169.254.169.254` |
| 大小 | 流式读取，超过 `MAX_SOURCE_BYTES`(32MB) 直接中断 |
| 超时 | 15s |
| 限流 | 单条 asset 每分钟最多 6 次，防止被当成代理刷 |
| 缓存 | 内存 LRU 缓存最近 50 张（约 100MB），**不落盘**。刷新页面重看要重新拉，这是刻意的取舍 |

**否决的替代方案**：
- 原图 + 压缩图都存 → 存储翻倍（20.7GB），用户明确表示不需要
- 纯透传代理，完全不缓存 → 连看几张图要反复回源，且源站可能限流；加个内存 LRU 既省流量又不占盘
- 只存原图靠前端缩放 → 首屏要下 20MB，手机流量和体验都受不了

**后果**：
- 存储 1 万条约 **10GB**（vs 22GB）
- 「预览原图」在网络好时可用；原文已删时不可用——**这是用户主动接受的取舍**
- 采集时必须保证 `origin_url` 非空，否则丢失该能力（进 §13 风险登记册）


---

## 3. 系统架构

### 3.1 组件图

```
┌──────────────────────────────────────────────────────────────────┐
│  客户端                                                          │
│  ┌──────────────┐  ┌────────────┐  ┌──────────────┐  ┌────────┐  │
│  │ Chrome MV3   │  │ PWA        │  │ iOS 快捷指令 │  │ 未来   │  │
│  │ 扩展         │  │ (iPhone/   │  │ (分享/剪贴板)│  │ iOS App│  │
│  │              │  │  iPad)     │  │              │  │        │  │
│  └──────┬───────┘  └─────┬──────┘  └──────┬───────┘  └───┬────┘  │
└─────────┼────────────────┼────────────────┼──────────────┼──────┘
          │  Bearer PAT    │  Cookie        │ Bearer PAT   │
          └────────────────┴───────┬────────┴──────────────┘
                                    ▼
┌──────────────────────────────────────────────────────────────────┐
│  pb-web  (Next.js 15 App Router)                                 │
│  ├─ UI: 列表 / Inbox / 阅读页 / 集合 / 标签 / 搜索 / 设置         │
│  └─ /api/v1: capture, items, assets, collections, tags, search   │
└────────────────────────────┬─────────────────────────────────────┘
                             │ 插入 job
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│  pb-db  (Postgres 16 + pgvector + pg_trgm)                       │
│  ├─ 业务表 (item/asset/collection/tag/...)                       │
│  ├─ pgboss schema (任务队列)                                     │
│  └─ 向量索引 (HNSW)                                              │
└────────────────────────────┬─────────────────────────────────────┘
                             │ 消费 job
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│  pb-worker  (Node.js 独立进程)                                    │
│  ├─ capture   : 选 adapter → 抓取 → 解析                          │
│  ├─ assets    : 下载 → sha256 → 原图落盘 → 派生 display/thumb      │
│  ├─ clean     : HTML 清洗 → 图片 src 重写                         │
│  ├─ index     : jieba 分词 → search_text                         │
│  ├─ embed     : ONNX bge-small-zh → pgvector                     │
│  └─ classify  : L1 规则 → L2 近邻传播 → L3 LLM                   │
└────────────────────────────┬─────────────────────────────────────┘
                             ▼
                    ./data/assets (bind mount)
```

### 3.2 采集数据流

```
capture 请求
   │
   ├─ 1. 规范化 URL（去 utm/spm/scene...）→ canonical_url
   ├─ 2. 去重检查（canonical_url 精确 + 正文 simhash 近似）
   │     └─ 命中 → 返回 409 + 已存在条目 id（前端提示"已收藏过"）
   ├─ 3. 平台识别 → 选 adapter（priority 降序）
   ├─ 4. adapter.capture()
   │     ├─ 客户端送来了 html？ → 直接解析，跳过网络请求
   │     └─ 只有 url？          → undici 抓取（带 UA/Referer/超时/大小上限）
   ├─ 5. 抽出 CaptureResult（title/author/publishedAt/contentHtml/cover/assets）
   ├─ 6. 存原始快照 gz
   ├─ 7. 图片管线：逐张落地 → 得到 { originUrl → assetId } 映射
   ├─ 8. HTML 清洗：<img src> 重写为 /api/v1/assets/:id，剥离 script/style/事件属性
   ├─ 9. 写 item + search_text(jieba) + embedding(ONNX)
   └─ 10. 入队 classify（异步，不阻塞"保存成功"）
```

**关键**：第 4 步"客户端送来了 html"是快路径，这是本项目相对 Karakeep 的本质差异。

### 3.3 目录结构

```
personal-bookmark/
├── SPEC.md                     ← 本文件
├── README.md
├── .env.example
├── docker-compose.yml
├── pnpm-workspace.yaml
├── package.json
├── apps/
│   ├── web/                    Next.js 15：UI + /api/v1
│   │   ├── app/
│   │   │   ├── (auth)/login/
│   │   │   ├── (app)/inbox/
│   │   │   ├── (app)/item/[id]/
│   │   │   ├── (app)/collection/[id]/
│   │   │   ├── (app)/search/
│   │   │   ├── (app)/settings/
│   │   │   └── api/v1/
│   │   ├── components/
│   │   └── lib/
│   ├── worker/
│   │   └── src/jobs/{capture,assets,clean,index,embed,classify}.ts
│   └── extension/              Chrome MV3
│       ├── manifest.json
│       ├── background.ts       ← 抓图必须在这里（有 host_permissions）
│       ├── content.ts          ← 页面内提取 DOM
│       └── popup.tsx
├── packages/
│   ├── core/
│   │   ├── adapters/{wechat,xhs,douyin,generic,note}.ts
│   │   ├── url.ts              规范化 + 平台识别
│   │   ├── fetcher.ts          undici 封装（UA/Referer/重试/限流）
│   │   ├── sanitize.ts         HTML 清洗 + 图片重写
│   │   ├── tokenize.ts         jieba 封装
│   │   ├── embed.ts            ONNX bge
│   │   ├── llm.ts              DeepSeek 兼容客户端
│   │   └── simhash.ts          内容指纹
│   ├── db/
│   │   ├── schema.ts           Drizzle schema
│   │   ├── migrations/
│   │   └── sql/                extensions + 函数索引（drizzle-kit 生成不了的部分）
│   └── contract/
│       ├── capture.ts          zod schema
│       ├── item.ts
│       └── index.ts
├── docs/
│   ├── deploy-ugreen.md        绿联 DXP4800 部署手册
│   └── api.md                  由 contract 生成的 OpenAPI
└── data/                       ← .gitignore，运行时挂载
    ├── db/
    ├── assets/
    └── config/
```

---

## 4. 数据模型

### 4.1 ER 概览

```
collection (树, 单归属)      tag (多归属)
     │ 1                        │ N
     │                          │
     └──────► item ◄────────────┘
                │ 1
      ┌─────────┼─────────┬──────────┬───────────┐
      │ N       │ N       │ 1        │ 1         │
    asset   highlight  snapshot  embedding(列内)
      │ 1
      │ N            ← 只有 thumb / display；原图不落盘，按需回源（ADR-013）
  asset_variant
```

### 4.2 Drizzle Schema 草案

```ts
// packages/db/schema.ts
import {
  pgTable, pgEnum, uuid, text, varchar, integer, bigint, real,
  timestamp, jsonb, boolean, index, uniqueIndex,
} from 'drizzle-orm/pg-core';

export const itemType = pgEnum('item_type', [
  'article', 'note', 'image', 'video', 'link',
]);
export const itemSource = pgEnum('item_source', [
  'wechat', 'xhs', 'douyin', 'web', 'manual',
]);
export const itemStatus = pgEnum('item_status', [
  'inbox', 'reading', 'archived',
]);
export const tagSource = pgEnum('tag_source', [
  'manual', 'rule', 'propagated', 'llm',
]);
export const assetKind = pgEnum('asset_kind', [
  'image', 'thumbnail', 'pdf', 'video', 'audio', 'cover',
]);

/* ── 集合：树形，单归属 ───────────────────────────── */
export const collection = pgTable('collection', {
  id:        uuid('id').primaryKey().defaultRandom(),
  parentId:  uuid('parent_id').references((): any => collection.id, {
               onDelete: 'cascade' }),
  name:      varchar('name', { length: 120 }).notNull(),
  sort:      integer('sort').notNull().default(0),
  aiEnabled: boolean('ai_enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  parentIdx: index('collection_parent_idx').on(t.parentId, t.sort),
}));

/* ── 条目主体 ─────────────────────────────────────── */
export const item = pgTable('item', {
  id:           uuid('id').primaryKey().defaultRandom(),
  type:         itemType('type').notNull().default('article'),
  source:       itemSource('source').notNull().default('web'),
  status:       itemStatus('status').notNull().default('inbox'),

  url:          text('url').notNull(),
  canonicalUrl: text('canonical_url').notNull(),

  title:        text('title'),
  author:       text('author'),
  siteName:     text('site_name'),
  excerpt:      text('excerpt'),
  publishedAt:  timestamp('published_at', { withTimezone: true }),
  savedAt:      timestamp('saved_at', { withTimezone: true }).notNull().defaultNow(),
  readAt:       timestamp('read_at', { withTimezone: true }),

  contentHtml:  text('content_html'),
  contentText:  text('content_text'),
  wordCount:    integer('word_count').notNull().default(0),
  lang:         varchar('lang', { length: 16 }).default('zh'),

  coverAssetId: uuid('cover_asset_id').references(() => asset.id, {
                  onDelete: 'set null' }),
  collectionId: uuid('collection_id').references(() => collection.id, {
                  onDelete: 'set null' }),

  /** jieba 预分词结果，供 to_tsvector('simple', ...) 使用 */
  searchText:   text('search_text').notNull().default(''),
  /** 64-bit 内容指纹，用于近似去重 */
  simhash:      bigint('simhash', { mode: 'bigint' }),
  /** bge-small-zh-v1.5, 512 维 */
  embedding:    text('embedding'),   // 迁移时改为 vector(512)

  adapterId:    varchar('adapter_id', { length: 32 }),
  meta:         jsonb('meta').$type<Record<string, unknown>>().default({}),

  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  canonIdx:  uniqueIndex('item_canonical_url_idx').on(t.canonicalUrl),
  statusIdx: index('item_status_saved_idx').on(t.status, t.savedAt),
  collIdx:   index('item_collection_idx').on(t.collectionId, t.savedAt),
  sourceIdx: index('item_source_idx').on(t.source),
  simIdx:    index('item_simhash_idx').on(t.simhash),
  urlIdx:    index('item_url_idx').on(t.url),
}));

/* ── 资源：只存压缩图，原图按需回源（ADR-013） ────── */
export const asset = pgTable('asset', {
  id:         uuid('id').primaryKey().defaultRandom(),
  itemId:     uuid('item_id').references(() => item.id, { onDelete: 'cascade' }),
  kind:       assetKind('kind').notNull().default('image'),

  /** 源文件字节的哈希。下载瞬间算出，用于去重与缓存键；文件本身不留 */
  sha256:     varchar('sha256', { length: 64 }).notNull(),
  /** 源文件 mime / 尺寸 / 体积，用于全屏时提示"原图约 2.4MB"，不需下载即可显示 */
  sourceMime:  varchar('source_mime', { length: 64 }),
  sourceWidth:  integer('source_width'),
  sourceHeight: integer('source_height'),
  sourceBytes:  integer('source_bytes'),

  /** 实际落盘的格式（通常是 webp；动图例外为 image/gif） */
  mime:       varchar('mime', { length: 64 }).notNull(),
  width:      integer('width'),
  height:     integer('height'),
  bytes:      integer('bytes').notNull().default(0),
  animated:   boolean('animated').notNull().default(false), // GIF/APNG → 不转码

  /**
   * 「预览原图」的唯一取数来源。采集时必须写入，
   * 为空则 sourceAvailable=false，UI 直接隐藏该按钮。
   */
  originUrl:     text('origin_url'),
  /** 公众号/小红书等需要特定 Referer 才能回源 */
  originReferer: text('origin_referer'),
  /** 回源时是否需要特定 UA（微信图部分场景校验） */
  originUserAgent: text('origin_user_agent'),

  sourceAvailable: boolean('source_available').notNull().default(true),
  sourceStatus:    varchar('source_status', { length: 16 })
                     .notNull().default('unknown'),   // unknown | ok | failed | gone
  sourceCheckedAt: timestamp('source_checked_at', { withTimezone: true }),
  sourceFailCount: integer('source_fail_count').notNull().default(0),

  createdAt:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  shaIdx:  uniqueIndex('asset_sha256_idx').on(t.sha256),
  itemIdx: index('asset_item_idx').on(t.itemId),
}));

/* ── 资源变体：只有 thumb / display ───────────────── */
export const assetVariantKind = pgEnum('asset_variant_kind', [
  'thumb', 'display',          // 不存在 original —— 原图不落盘
]);

export const assetVariant = pgTable('asset_variant', {
  id:         uuid('id').primaryKey().defaultRandom(),
  assetId:    uuid('asset_id').notNull().references(() => asset.id, { onDelete: 'cascade' }),
  variant:    assetVariantKind('variant').notNull(),

  /** 形如 ab/abcdef...-display.webp（sha256 前两位分桶） */
  storageKey: text('storage_key').notNull(),
  mime:       varchar('mime', { length: 64 }).notNull(),
  bytes:      integer('bytes').notNull().default(0),
  width:      integer('width'),
  height:     integer('height'),

  createdAt:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pk:      uniqueIndex('asset_variant_pk').on(t.assetId, t.variant),
  variant: index('asset_variant_kind_idx').on(t.variant),
}));

/* ── 标签 ─────────────────────────────────────────── */
export const tag = pgTable('tag', {
  id:    uuid('id').primaryKey().defaultRandom(),
  name:  varchar('name', { length: 64 }).notNull(),
  color: varchar('color', { length: 16 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  nameIdx: uniqueIndex('tag_name_idx').on(t.name),
}));

export const itemTag = pgTable('item_tag', {
  itemId:     uuid('item_id').notNull().references(() => item.id, { onDelete: 'cascade' }),
  tagId:      uuid('tag_id').notNull().references(() => tag.id, { onDelete: 'cascade' }),
  source:     tagSource('source').notNull().default('manual'),
  confidence: real('confidence').notNull().default(1),
  createdAt:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pk:      uniqueIndex('item_tag_pk').on(t.itemId, t.tagId),
  tagIdx:  index('item_tag_tag_idx').on(t.tagId),
}));

/* ── 高亮 ─────────────────────────────────────────── */
export const highlight = pgTable('highlight', {
  id:        uuid('id').primaryKey().defaultRandom(),
  itemId:    uuid('item_id').notNull().references(() => item.id, { onDelete: 'cascade' }),
  quote:     text('quote').notNull(),
  prefix:    text('prefix').notNull().default(''),   // 前 32 字符，抗清洗定位
  suffix:    text('suffix').notNull().default(''),   // 后 32 字符
  offset:    integer('offset').notNull().default(0), // 辅助定位
  color:     varchar('color', { length: 16 }).notNull().default('yellow'),
  note:      text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  itemIdx: index('highlight_item_idx').on(t.itemId),
}));

/* ── 原始快照 ─────────────────────────────────────── */
export const snapshot = pgTable('snapshot', {
  id:        uuid('id').primaryKey().defaultRandom(),
  itemId:    uuid('item_id').notNull().references(() => item.id, { onDelete: 'cascade' }),
  rawGz:     text('raw_gz').notNull(),   // base64(gzip(html))，大文本走 TOAST
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  bytes:     integer('bytes').notNull().default(0),
}, (t) => ({
  itemIdx: index('snapshot_item_idx').on(t.itemId),
}));

/* ── 保存的查询（智能集合） ───────────────────────── */
export const smartView = pgTable('smart_view', {
  id:       uuid('id').primaryKey().defaultRandom(),
  name:     varchar('name', { length: 120 }).notNull(),
  filter:   jsonb('filter').notNull().$type<Record<string, unknown>>(),
  sort:     integer('sort').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/* ── 规则（L1 自动分类） ──────────────────────────── */
export const rule = pgTable('rule', {
  id:         uuid('id').primaryKey().defaultRandom(),
  name:       varchar('name', { length: 120 }).notNull(),
  enabled:    boolean('enabled').notNull().default(true),
  /** 匹配条件：域名 / URL 正则 / 标题关键词 / 来源 */
  match:      jsonb('match').notNull().$type<Record<string, unknown>>(),
  /** 命中动作：设集合 / 加标签 / 设类型 */
  action:     jsonb('action').notNull().$type<Record<string, unknown>>(),
  priority:   integer('priority').notNull().default(100),
  hitCount:   integer('hit_count').notNull().default(0),
  createdAt:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/* ── 访问令牌 ─────────────────────────────────────── */
export const accessToken = pgTable('access_token', {
  id:         uuid('id').primaryKey().defaultRandom(),
  name:       varchar('name', { length: 80 }).notNull(),
  tokenHash:  varchar('token_hash', { length: 64 }).notNull(),
  prefix:     varchar('prefix', { length: 12 }).notNull(),  // 明文前缀，便于识别
  scopes:     text('scopes').array().notNull().default(['capture', 'read']),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  expiresAt:  timestamp('expires_at', { withTimezone: true }),
  createdAt:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  hashIdx: uniqueIndex('access_token_hash_idx').on(t.tokenHash),
}));
```

### 4.3 Drizzle 生成不了的部分（手写迁移）

```sql
-- packages/db/sql/001_extensions.sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- embedding 列改为原生 vector 类型（drizzle 用 customType 或此 SQL）
ALTER TABLE item ALTER COLUMN embedding TYPE vector(512) USING NULL;
```

```sql
-- packages/db/sql/002_indexes.sql

-- 中文全文（ADR-005）
CREATE INDEX item_fts_idx ON item
  USING gin (to_tsvector('simple', search_text));

-- 标题模糊/子串兜底
CREATE INDEX item_title_trgm_idx ON item
  USING gin (title gin_trgm_ops);

-- 语义检索（ADR-010）；1万条 HNSW 无需训练调参
CREATE INDEX item_embedding_idx ON item
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
```

### 4.4 关键约束说明

| 约束 | 说明 |
|---|---|
| `item.canonical_url` UNIQUE | 精确去重。规范化规则见 §6.4 |
| `asset.sha256` UNIQUE | **原始字节**的哈希。同一张图跨条目复用，原图和派生件都只存一份 |
| `asset_variant (asset_id, variant)` 唯一 | 一个资源每种档位只有一份，重跑派生是 upsert |
| `item_tag (item_id, tag_id)` 唯一 | 防重复打标 |
| `snapshot.raw_gz` 用 TEXT | Postgres TOAST 会自动压缩+外置，10k 条无压力 |
| 全表 `ON DELETE CASCADE` | 删条目连带资源记录；**文件（两档变体）由 GC 任务异步清理** |

### 4.5 迁移策略

- `drizzle-kit generate` 出结构
- 手写 SQL 放 `packages/db/sql/`，用 `drizzle-kit migrate` 的 custom migration 机制串起来
- **容器启动时自动跑迁移**（M0 单用户，不需要零停机策略）

---

## 5. API 契约

### 5.1 认证

| 场景 | 方式 |
|---|---|
| Web UI | `POST /api/v1/auth/login` → HttpOnly + Secure + SameSite=Lax cookie（JWT HS256，30 天） |
| 扩展 / 快捷指令 / iOS | `Authorization: Bearer pb_<32字节base62>`，SHA-256 存库 |

- 密码用 `@node-rs/argon2` 哈希，存 `./data/config/auth.json` 或 DB
- 首启若无密码，生成随机密码**打印到容器日志**
- PAT 可在设置页生成/吊销，明文只显示一次

### 5.2 端点总表

| 方法 | 路径 | 说明 | 稳定度 |
|---|---|---|---|
| POST | `/api/v1/auth/login` | 登录，发 cookie | 稳定 |
| POST | `/api/v1/auth/logout` | 登出 | 稳定 |
| GET | `/api/v1/auth/me` | 当前身份 | 稳定 |
| **POST** | **`/api/v1/capture`** | **核心：保存一条** | **稳定** |
| GET | `/api/v1/capture/:jobId` | 查询保存进度 | 稳定 |
| POST | `/api/v1/assets/upload-url` | 申请直传地址 | 稳定 |
| POST | `/api/v1/assets/commit` | 确认上传（算 sha256 → 派生 thumb+display，丢弃源文件） | 稳定 |
| GET | `/api/v1/assets/:id` | 读取 **display** 变体（同源，强缓存） | 稳定 |
| GET | `/api/v1/assets/:id/thumb` | 读取 **thumb** 变体 | 稳定 |
| GET | `/api/v1/assets/:id/meta` | 元信息（源尺寸/体积/是否可回源），供「预览原图」按钮显示"约 2.4MB" | 稳定 |
| **GET** | **`/api/v1/assets/:id/source`** | **「预览原图」：按需从 `origin_url` 回源，流式返回，内存 LRU 缓存，不落盘** | 稳定 |
| GET | `/api/v1/items` | 列表（过滤/分页/排序） | 稳定 |
| GET | `/api/v1/items/:id` | 详情（含正文、资源、标签、高亮） | 稳定 |
| PATCH | `/api/v1/items/:id` | 改标题/集合/状态 | 稳定 |
| DELETE | `/api/v1/items/:id` | 删除 | 稳定 |
| POST | `/api/v1/items/:id/retry` | 重新抓取（用快照或重新请求） | 稳定 |
| PATCH | `/api/v1/items/batch` | 批量改集合/状态/加标签 | 稳定 |
| GET/POST/PATCH/DELETE | `/api/v1/collections[/:id]` | 集合树 CRUD | 稳定 |
| GET/POST/PATCH/DELETE | `/api/v1/tags[/:id]` | 标签 CRUD | 稳定 |
| GET | `/api/v1/search` | 全文 + 语义混合检索 | 稳定 |
| POST/PATCH/DELETE | `/api/v1/highlights` | 高亮 CRUD | 稳定 |
| GET/POST/PATCH/DELETE | `/api/v1/rules[/:id]` | 自动分类规则 | 稳定 |
| GET/POST/DELETE | `/api/v1/tokens[/:id]` | PAT 管理 | 稳定 |
| POST | `/api/v1/export` | 导出 Markdown 包 | 稳定 |
| GET | `/api/v1/stats` | 统计（条目数/占用/队列积压） | 实验 |

### 5.3 `POST /api/v1/capture` — 三档能力语义（核心契约）

```ts
// packages/contract/capture.ts
import { z } from 'zod';

export const CaptureMode = z.enum(['auto', 'url-only', 'full']);

export const CaptureRequest = z.object({
  url: z.string().url(),

  /** auto: 按客户端类型推断；url-only: 只给链接；full: 客户端已抓全 */
  mode: CaptureMode.default('auto'),

  /**
   * 客户端拿到的整页 HTML。有它则服务端跳过网络请求。
   * 上限 8MB，超出走 assets 通道或降级为 url-only。
   */
  html: z.string().max(8 * 1024 * 1024).optional(),

  /** 已上传的资源 id（图片），顺序即文档中的出现顺序 */
  assetIds: z.array(z.string()).max(200).optional(),

  /** 客户端初步解析结果（可选，服务端会复核） */
  hint: z.object({
    title: z.string().optional(),
    author: z.string().optional(),
    excerpt: z.string().optional(),
    coverUrl: z.string().url().optional(),
    publishedAt: z.string().datetime().optional(),
    /** 富文本备注的 HTML（S3 场景） */
    noteHtml: z.string().optional(),
  }).optional(),

  /** 目标集合；不给则落 Inbox */
  collectionId: z.string().uuid().optional(),
  /** 立即附加的标签名（不存在则创建） */
  tags: z.array(z.string()).max(20).optional(),

  client: z.enum(['extension', 'pwa', 'ios', 'api', 'manual']).default('api'),
});

export const CaptureResponse = z.object({
  itemId: z.string().uuid(),
  jobId: z.string(),
  status: z.enum(['queued', 'processing']),
  /** 已存在时返回其 id，status='duplicate' */
  duplicate: z.boolean().default(false),
});
```

**三档语义表**

| 客户端 | 送什么 | 服务端行为 | 保真度 |
|---|---|---|---|
| iOS 快捷指令 | `{url}` | 全服务端抓取（undici + adapter） | 中（公众号多数可过） |
| PWA 粘贴 | `{url, hint:{excerpt}}` | 同上 + 从分享文本抽标题/封面 | 中 |
| 浏览器扩展 | `{url, html, assetIds}` | 跳过抓取，只清洗 + 入库 | **最高** |
| 手工粘贴整页 | `{url, html}` | 兜底，永远可用 | 高 |
| 文字/图片备忘 | `{url: 'about:blank', hint:{noteHtml}, assetIds}` | 不走 adapter | — |

> **设计要点**：服务端不假设客户端给了什么，而是**按收到的完整度自动选择路径**。这让同一套接口能同时服务从"只有链接"到"全量 HTML+图片"的所有客户端。

### 5.4 资源两段式上传

大图不能塞 JSON（base64 膨胀 33%，且 8MB 上限会立刻撞墙）。

```
① POST /api/v1/assets/upload-url
   { contentType: "image/jpeg", bytes: 284331, filename: "img-1.jpg" }
   → { assetId, uploadUrl, method: "PUT", fields?: {...} }

② PUT uploadUrl  (二进制体直接上传，不经 JSON)

③ POST /api/v1/assets/commit
   { assetId }
   → { id, sha256, sourceBytes, sourceAvailable,
       variants: { thumb:   {url, w, h, bytes},
                   display: {url, w, h, bytes} } }
```

- 存储后端抽象为 `Storage` 接口：M0 只实现 `LocalDisk`（`./data/assets`），M3 可加 S3/WebDAV
- `commit` 内做四件事：
  1. 算源字节 `sha256` → 命中已有 asset 则**直接复用**已有变体，跳过派生（跨条目去重）
  2. 把源文件写到 **临时目录**（`/tmp/pb-upload`），只用于派生，**派完即删**
  3. 派生 `display`（webp 长边 ≤2000 q85，剥 EXIF）与 `thumb`（webp 400 q75）
  4. 记录 `sourceWidth/sourceHeight/sourceBytes/sourceMime`（原图元信息，供 UI 提示用），然后丢弃源文件
- 动图（GIF/APNG）是唯一例外：不转码，`display` 直接保存源字节（转码会丢帧）
- 派生在 worker 里异步做，`commit` 立刻返回并带 `variants.display.url` 占位；未就绪时该 URL 回落到 `thumb`（**不会**回落到源站）
- **临时文件用 `try/finally` 保证清理**，容器启动时也清一次 `/tmp/pb-upload`，避免崩溃残留把盘撑满

### 5.5 状态码约定

| 码 | 场景 |
|---|---|
| 200 | 成功 |
| 202 | 已入队（capture 正常返回） |
| 400 | schema 校验失败（zod issue 原样返回） |
| 401 | 未认证 / PAT 无效 |
| 403 | PAT 缺 scope |
| 404 | 资源不存在 |
| 409 | 重复条目（body 带 `existingItemId`） |
| 422 | 抓取失败但请求合法（`{ reason: 'fetch_blocked' \| 'adapter_failed' }`） |
| 429 | 触发限流 |
| 500 | 未预期错误（带 `traceId`） |

错误体统一：

```json
{ "error": { "code": "DUPLICATE_ITEM", "message": "该链接已收藏", "existingItemId": "..." } }
```

### 5.6 列表与搜索查询

```
GET /api/v1/items?
  status=inbox|reading|archived|all
  collection=<uuid>
  tag=<name>            (可重复)
  source=wechat|xhs|douyin|web|manual
  type=article|note|image|video|link
  q=<关键词>             (走 FTS)
  from=2026-01-01&to=2026-11-23
  sort=saved_desc|saved_asc|published_desc|read_time
  cursor=<opaque>&limit=50
```

- 分页用 **cursor**（keyset on `saved_at, id`），不用 offset——1 万条下 offset 也够，但 cursor 免费且未来不用改
- `q` 与向量检索分离：`/items?q=` 走全文，`/search?mode=semantic` 走向量，M2 再做混合

---

## 6. Adapter 规范

### 6.1 接口

```ts
// packages/core/adapters/types.ts
export interface CaptureContext {
  url: URL;
  /** 客户端送来的原始 HTML；为空则 adapter 需自行抓取 */
  html?: string;
  /** 客户端已上传的图片，按 DOM 出现顺序 */
  uploadedAssets?: Array<{ assetId: string; originUrl?: string }>;
  /** 抓取器（带正确的 UA/Referer/超时/重试） */
  fetcher: Fetcher;
  /** 外部资源解析器：把远程图片转成 assetId */
  resolver: AssetResolver;
  log: Logger;
}

export interface CaptureResult {
  type: 'article' | 'note' | 'image' | 'video' | 'link';
  source: 'wechat' | 'xhs' | 'douyin' | 'web' | 'manual';
  title?: string;
  author?: string;
  siteName?: string;
  excerpt?: string;

  /** 已清洗、图片已改写为 /api/v1/assets/:id 的 HTML */
  contentHtml: string;
  contentText: string;

  publishedAt?: Date;
  coverAssetId?: string;

  /** 原始报文，进 snapshot 表 */
  rawSnapshot?: { kind: 'html' | 'json'; body: string; encoding?: string };
  meta: Record<string, unknown>;
  /** 部分成功也要返回：例如正文拿到了但封面失败 */
  warnings: string[];
}

export interface Adapter {
  id: string;
  priority: number;                    // 越大越优先，generic = 0
  match(url: URL): boolean;
  capture(ctx: CaptureContext): Promise<CaptureResult>;
}
```

### 6.2 降级链

```
选 adapter（match && priority 降序）
   │
   ├─ 有客户端 HTML？→ 直接解析（最保真）
   ├─ 有网络？→ adapter.capture() 内部 fetcher
   │      └─ 失败 → 尝试 generic adapter（Readability）
   └─ 全失败 → 保存"裸链接"条目（type='link'，只有 url + 用户 hint）
              └─ 状态标 fetch_failed，UI 显示"仅保存了链接"，可一键重试
```

**原则：采集永不整体失败。** 最差也要留住链接和用户写的东西。这是"记录"类产品的底线。

### 6.3 平台 Adapter 职责

#### `wechat` — 微信公众号（M0 核心）

```ts
match: url.hostname === 'mp.weixin.qq.com' && url.pathname.startsWith('/s')

解析要点：
  正文     $('div#js_content')
  标题     $('h1#activity-name').text()      || 页面 JS 变量 msg_title
  作者     $('#js_name').text()               || 变量 nickname
  发布态   变量 ct（Unix 秒）→ publishedAt
  封面     `msg_cdn_url` 变量 或 meta[property="og:image"]
  类型     $('meta[property="og:type"]')     // 可用于判断是图文/视频/图片消息

  图片地址优先级（顺序不能错）：
      img.attr('data-src')
   || img.attr('data-original')
   || img.attr('data-lazy-src')
   || img.attr('src')            // 兜底，可能只是占位图

  图片下载必须带：
      Referer: https://mp.weixin.qq.com/
      User-Agent: Mozilla/5.0 ... MicroMessenger/8.x ...   // 部分文章校验
```

**踩坑清单（已验证）：**
1. `data-src` 中的 `&amp;` 要解码，否则 404
2. 图片 URL 带 `wx_fmt=` 参数，决定格式；不要盲目信任扩展名
3. 正文里有 `<section>` 嵌套，样式靠 inline style；清洗时**不要**剥掉 `style`（公众号排版全靠它），只剥 `<script>`、`<iframe>`、`on*` 属性
4. 部分文章是"分享页"（`/s?__biz=...&scene=...`），结构同正文，但可能带登录引导，需剔除 `#js_pc_qr_code` 之类
5. 视频文章（`og:type=video`）需要额外抽 `vid`，M1 再处理

#### `xhs` — 小红书

```
match: xiaohongshu.com/explore/* 或 /discovery/item/*

服务端能力有限（需 xsec_token，会过期）。策略分两级：
  A. 扩展在场：读 window.__INITIAL_STATE__ 里的 note 数据
     → title / desc / user.nickname / imageList[].urlDefault / time
     → 逐张下载（sns-webpic 有防盗链）
  B. 服务端兜底：只取 <meta og:title/og:image/og:description>
     → 存成"链接 + 封面 + 摘要"卡片，标注 full=false

分享文本解析：小红书分享出来是
  "标题 - 小红书\nhttps://www.xiaohongshu.com/explore/xxx?xsec_token=..."
短链 xhslink.com 需先 HEAD 展开。
```

#### `douyin` — 抖音

```
match: douyin.com/video/* , /note/* , v.douyin.com/*

决策：默认只存元信息，不存视频本体（体积 + 签名过期）
  标题/作者/封面/时长/文案 ← 从 _ROUTER_DATA 或 RENDER_DATA 提取
  视频下载：可选开关 DOUYIN_DOWNLOAD_VIDEO=true（走 yt-dlp 或直链）
  直链 video.play_addr 带签名，**必须保存当下就下**，过期即失效
```

#### `generic` — 通用网页（兜底，priority=0）

```
jsdom + @mozilla/readability
  → article.title / byline / publishedTime / content / textContent
  → 封面取 og:image
兜底价值：任何网页都能变成一个能读的条目
```

#### `note` — 文字/图片速记（不走网络）

```
输入：hint.noteHtml + assetIds
产出：type='note'，title 取首行或"未命名速记"
编辑器：TipTap，支持粘贴图片直接上传
```

**实现状态（v0.9）**：已实现，但与上面有三处刻意偏离。

| 项 | 原设计 | 实际 | 原因 |
|---|---|---|---|
| 编辑器 | TipTap | 纯 `<textarea>` + 图片附件 | 速记的价值是"快"；富文本会让人开始排版，反而慢了。需要排版的内容应该走文章 |
| 图片处理 | worker 队列 | web 请求内同步处理 | "点了就存下来"，走队列反而慢。但派生参数与 MIME 映射仍共用 `@pb/core` 的那一份 |
| 数据模型 | hint.noteHtml | `item.type='note'`, `url` 为 NULL | 速记没有来源链接，硬塞一个伪 URL 后患更多（reader 的「原文 ↗」、去重都得多加判断） |

配套改动：

- `item.url` / `item.canonical_url` 改为可空；唯一索引改为**部分索引**
  （`WHERE canonical_url IS NOT NULL`），否则多条速记的 NULL 会互相冲突（迁移 `0004`）
- 图片派生逻辑拆成两半：`@pb/core` 导出纯逻辑（`normalizeMime` / `extForMime` /
  `DEFAULT_RENDER`），需要 sharp 的 `renderVariants` 走 `@pb/core/image` 子路径。
  **原因**：web 通过 `transpilePackages` 把 core 源码编进自己的包，core 主入口一旦
  出现 `import sharp`，webpack 会把 sharp 也打进去，构建阶段直接失败
  （`Could not load the sharp module using the win32-x64 runtime`）。
- 上传接口 `POST /api/v1/notes`（multipart）：`text` + 0–9 个 `images`。
  单张 ≤15MB，单条 ≤9 张；重复图片按 sha256 去重；单张失败不影响整条，
  失败原因回传给前端显示。

### 6.4 URL 规范化规则

```ts
// packages/core/url.ts
// 1. 小写 host、去默认端口、去 fragment
// 2. 剥离追踪参数（大小写不敏感）
const DROP_PARAMS = [
  'utm_*', 'spm', 'scm', 'from', 'from_source', 'share_source', 'share_medium',
  'scene', 'ascene', 'devicetype', 'version', 'nettype', 'lang', 'isappinstalled',
  'clicktime', 'enterid', 'sessionid', 'wx_header', 'exportkey', 'pass_ticket',
  'nsukey', '_hsenc', '_hsmi', 'fbclid', 'gclid', 'share_token',
];
// 3. 微信：只保留 __biz, mid, idx, sn —— 这四个决定唯一性
// 4. 小红书：保留 noteId，丢弃全部 xsec_* 参数（xsec_token 会过期、xsec_source 会变，
//    任一参与去重都会让同一条笔记重复入库）
// 5. 抖音：短链先展开，保留 item_id
// 6. 末尾斜杠一律去掉（根路径除外）。注意：不能"有 query 就保留"——
//    /post/?a=1 与 /post?a=1 是同一个资源，留斜杠会把一篇文章记成两条
```

### 6.5 适配器测试策略

- 每个 adapter 配 `fixtures/<id>/` 目录，存放**最小化的合成 HTML**，只复现结构特征（`#js_content`、`data-src`、`<script>var nickname=...`）
- **绝不提交真实文章正文**到仓库（版权问题，开源后会被投诉）
- 断言：标题/作者/时间正确、图片数正确、`data-src` 优先于 `src`、`&amp;` 已解码

---

## 7. 分类系统

### 7.1 三层递进

```
L1 规则（确定性，~1ms）      →  覆盖约 60%
L2 向量近邻传播（~50ms）     →  再覆盖 25%
L3 LLM 打标（2–5s，可关）    →  收尾 + 摘要
```

**核心原则：AI 不替用户拍板，只"站旁边递牌"。**

### 7.2 L1：确定性规则

规则存 `rule` 表，UI 可编辑、可测试、可看命中数。

```jsonc
// match —— 任一字段命中即算匹配（AND 语义在字段内部）
{ "hostIn": ["mp.weixin.qq.com"],
  "urlRegex": "^/s",
  "source": "wechat" }

// action
{ "setCollection": "<uuid>",        // 集合树
  "addTags": ["公众号"],
  "setType": "article" }
```

**默认内置规则（首启 seed）：**

| 规则 | 匹配 | 动作 |
|---|---|---|
| 微信公众号 | `host = mp.weixin.qq.com` | 来源=wechat，集合=`公众号`，标签 `["微信"]` |
| 小红书 | `host ~ xiaohongshu.com\|xhslink.com` | 来源=xhs，集合=`小红书` |
| 抖音 | `host ~ douyin.com` | 来源=douyin，集合=`抖音` |
| 公众号→按账号分 | `siteName/author` 非空 | 自动建子集合 `公众号/<账号名>` |

> 最后一条价值最高：**它把你需求 1 的分类工作直接干掉一大半**——存 20 个公众号的文章，自动分成 20 个子集合。

### 7.3 L2：向量近邻标签传播

```
新条目 embedding v
   ↓ pgvector kNN（k=8，cosine 距离 < 0.25）
   ↓ 取这些邻居的 item_tag
   ↓ 按"邻居相似度加权"投票，且只信 source ∈ {manual, rule}
   ↓ 得票率 > 40% 且票数 ≥ 2 的标签 → 建议（source='propagated'）
```

**为什么比纯 LLM 好**：它会学着长成**你自己的**分类体系。你叫它"产品设计"，它就不会给你打"UI/UX Design"。LLM 给的是通用分类，传播给的是你的分类。

**冷启动**：邻居不足 5 条时跳过，只信 L1。

### 7.4 L3：LLM

```ts
// 输入：标题 + 作者 + 正文前 3000 字 + 现有标签全集（帮助它复用而非新造）
// 输出：严格 JSON
{
  "summary": "一句话摘要（40 字内）",
  "tags": ["产品设计", "AI"],           // 3–8 个，优先复用已有标签
  "confidence": 0.82,
  "worthReading": "一句话说为什么值得读"
}
```

**工程要点：**

| 项 | 做法 |
|---|---|
| 结构化输出 | 提示词内嵌 schema + `response_format: json_object` + zod 校验 + 失败重试 1 次 |
| 省钱 | 批量合并，一次 10 条（`BATCH_SIZE=10`），省 ~50% |
| 幂等 | 同一 `item_id` 的 LLM 结果缓存进 `item.meta.llm`，不重复调用 |
| 降级 | 无 API key 或集合 `ai_enabled=false` → 直接跳过，不报错 |
| 触发时机 | **不阻塞保存**。保存成功即返回，L3 在后台队列跑 |
| 撤销 | 自动标签 `source ∈ {llm, propagated}`，UI 上用淡色显示，可"全部移除"一键回退 |

### 7.5 人工交互（留存关键）

**Inbox 键盘流**（列表内，全程不碰鼠标）：

| 键 | 动作 |
|---|---|
| `j` / `k` | 下 / 上 |
| `space` | 展开预览 / 收起 |
| `Enter` | 打开阅读页 |
| `t` | 打标签（弹出搜索框，拼音首字母匹配） |
| `c` | 选集合（数字键 1–9 快捷选） |
| `a` | 归档（出 Inbox） |
| `u` | 撤销上一步 |
| `x` | 多选模式 |
| `Shift+J/K` | 扩展选区 |
| `?` | 快捷键帮助 |

**其他交互：**
- 批量：选中 N 条 → 统一设集合/加标签/归档
- 智能集合：保存查询（`未读 + #AI + 30天内`）
- 建议栏：卡片右侧显示 `建议：#产品设计 #AI · 来自 3 篇相似收藏 → 接受 / 换一个`
- **可解释才可信**：显示建议来源（哪个规则 / 哪些邻居 / LLM）

---

## 8. 阅读与检索

### 8.1 渲染隔离

```html
<!-- 阅读页：srcdoc + sandbox，彻底隔离原站样式 -->
<iframe
  sandbox=""                          <!-- 无 allow-scripts，XSS 零风险 -->
  srcdoc="{清洗后的 HTML + 注入的排版 CSS}"
  class="reader-frame" />
```

- 不用 `dangerouslySetInnerHTML`（公众号 HTML 里有各种怪东西）
- 注入的 CSS 用 CSS 变量控制：`--reader-font-size`、`--reader-line-height`、`--reader-font-family`
- 主题：浅/深/护眼（米黄）；字体：系统 / 思源宋体 / 霞鹜文楷
- 阅读进度：记录 `scrollRatio` 到 localStorage，下次恢复；>90% 且停留 >60s 自动标已读

**阅读页头部（Q6 已定）**

```
┌──────────────────────────────────────────────────────────┐
│ ← 返回          标题（可编辑）        [原文 ↗]  [⋯]        │
│                 作者 · 公众号名 · 2026-11-20 · 3,200 字   │
└──────────────────────────────────────────────────────────┘
```

- **`[原文 ↗]` 必须存在，且新页面打开**：`<a target="_blank" rel="noopener noreferrer">`
- 位置固定在第一行工具条右侧，与收藏夹操作并列（不藏进 `⋯` 菜单——用户明确要求"要"，藏起来就等于没有）
- 打开的是 `item.url`（原始链接，**不是** canonical_url，后者去掉了分享参数，可能导致原站打不开）
- 若原文已失效（4xx/超时），不阻塞：链接照常可点，浏览器自己报错即可；可选地在 M1 做一个后台探活，失效的标灰
- 同一条目在**列表卡片**上也给一个弱化的 ↗ 图标，方便不进阅读页也能跳原文

### 8.2 图片渲染与「预览原图」（ADR-013 两档）

```html
<!-- 清洗后：只认本地 asset，正文默认加载 display -->
<img src="/api/v1/assets/<id>"
     data-thumb="/api/v1/assets/<id>/thumb"
     data-source="/api/v1/assets/<id>/source"
     data-source-available="true"
     data-source-bytes="2457600"
     width="1080" height="720" loading="lazy" decoding="async" />
```

**两级加载策略（原图不在其中）：**

| 阶段 | 加载 | 触发 |
|---|---|---|
| 占位 | `thumb`（400w） | 即将进入视口（`rootMargin: 400px`） |
| 正文显示 | `display`（≤2000w, q85） | 进入视口后替换 thumb |
| 原图 | **不预加载** | 只有按下「预览原图」才请求 |

**lightbox（阅读页点击图片 = 全屏）**

```
遮罩层内 <img> 当前显示 display（居中、可缩放）
   下侧工具条（用户指定的位置）：
      [ 预览原图 ]   ← 唯一的原图入口，默认只显示这一项
      [ 关闭 × ]

   按下「预览原图」后：
     ① 按钮变 loading：「正在获取原图… 约 2.4MB」
        （体积来自 asset.sourceBytes，不需要先下载）
     ② GET /api/v1/assets/:id/source
     ③ 成功 → 原地替换为原图，工具条变成「原图 1080×1440 · 2.4MB」
     ④ 失败 → 保留 display，按钮变灰，提示
        「原图已不可获取（原文可能已删除）」
     ⑤ 源不可用时（sourceAvailable=false）→ 该按钮**根本不渲染**
```

- 只在按下时发起请求。**不预取、不后台拉、不进视口就下载**
- 手势：遮罩点击 / Esc 关闭；手机上支持下滑关闭；双指缩放、桌面滚轮缩放
- 手机上长按图片 → 系统「存储图像」（浏览器原生，不额外实现）
- 加载中允许取消（AbortController），避免大图卡住界面
- **超过 10MB 时先弹确认**（NAS 走外网时省流量），这个判断用 `sourceBytes`，不需要 HEAD 请求

**回源失败的降级（这是常态，不是异常）**

| 情况 | UI |
|---|---|
| 源站 410/404 | 按钮灰掉 + 「原文已删除，仅保留压缩图」 |
| 超时 / 网络错 | 「获取失败，可重试」+ 保留重试按钮 |
| 源站返回非图片 | 「原图不可获取」+ 记 `source_status='failed'` |
| `source_url` 为空 | 按钮不渲染 |

**缓存头**

- `display` / `thumb` 带 `ETag`（内容 sha256）+ `Cache-Control: public, max-age=31536000, immutable`，可长缓存
- `/source` 带 `Cache-Control: private, max-age=300`（只缓存 5 分钟，避免占浏览器缓存，也避免用户看到已过期的图）
- 服务端内存 LRU（最近 50 张）只是转发加速，不落盘

### 8.3 高亮定位

四元组 `{quote, prefix, suffix, offset}`：

```
1. 优先：在 contentText 中找 prefix+quote+suffix 唯一匹配
2. 退化：找 quote 的全部出现位置，用 offset 选最近的
3. 再退化：quote 模糊匹配（去空白归一化）
4. 全失败：标记"位置已失效"，只在侧栏显示引文（不丢失用户数据）
```

存 `contentText` 而不是 `contentHtml` 做定位基准——重跑清洗器时 HTML 会变，纯文本稳定得多。

### 8.4 检索

| 类型 | 实现 | 用途 |
|---|---|---|
| 全文 | `to_tsvector('simple', search_text) @@ plainto_tsquery(...)` | 关键词精确 |
| 模糊 | `title % 查询词`（pg_trgm） | "标题里好像有个词" |
| 语义 | `embedding <=> 查询向量` | "那篇讲 XX 的，标题忘了" |
| 结构化 | 普通 WHERE | 来源/时间/标签/状态 |

**排序融合（M2）：**

```sql
score = 0.6 * ts_rank
      + 0.3 * (1 - cosine_distance)
      + 0.1 * recency_decay(saved_at)
-- 已归档 × 0.8，已读 × 0.9（用户找的多半是没读的）
```

### 8.5 分词写入路径

```
item 写入/更新
  → tokenize(`${title} ${author} ${siteName} ${contentText}`)
  → 截断到前 20000 字（公众号长文够用，避免 search_text 爆炸）
  → 空格连接 → search_text
  → 同时算 simhash(contentText) 和 embedding(title + excerpt + 前 1000 字)
```

---

## 9. 界面与交互

> 外观骨架参考 **Cubox**（结构与气质）和 **Karakeep**（信息密度与暗色）。两份产品各自的长处不同，本节逐项说明取谁、为什么。

### 9.1 参考对象与取舍

| 方面 | Cubox | Karakeep | 本项目取谁 |
|---|---|---|---|
| 信息架构 | 集合树 + 标签 + 收件箱 | 列表(List) + 标签 | **Cubox** —— 需要"自动分类 + 人手分类"，树不可少 |
| 列表呈现 | 卡片、封面大、留白多 | 卡片/网格、密度可调 | **Karakeep 的密度可调 + Cubox 的克制留白** |
| 阅读位置 | 右侧第三栏内联 | 独立阅读页 | **两者都要**：桌面三栏内联、移动端独立页 |
| 移动端导航 | 底部 4 tab | 汉堡菜单 | **Cubox** |
| 键盘操作 | 弱 | 弱 | **自己补**（§7.5）—— 这是两者都没做好的地方 |
| 暗色模式 | 有 | 有且质量高 | **Karakeep**，且 Day 1 就要有 |
| 视觉气质 | 轻盈、iOS 感 | 工具感、密度高 | **Cubox 的"轻" + Karakeep 的"密"** |

一句话原则：**结构学 Cubox，密度学 Karakeep，键盘流自己补。**

### 9.2 响应式布局

只做三档断点，不追求更多：

```
≥1280px ── 三栏（Cubox 桌面形态）
┌────────┬──────────────┬─────────────────────────────┐
│ 侧栏   │ 列表          │ 阅读区                      │
│ 240px  │ 400px 可调    │ 弹性，正文居中 ≤68ch        │
└────────┴──────────────┴─────────────────────────────┘
          ↑ 拖拽分隔条调宽，双击复位

1024–1280px ── 两栏
┌────────┬──────────────┐
│ 侧栏   │ 列表          │  → 点条目跳独立阅读页
└────────┴──────────────┘

<1024px（iPhone / iPad 竖屏）── 单栏
┌──────────────────────┐
│ 列表                  │  → push 阅读页（右滑返回）
│                      │
│              [＋] FAB │
└──────────────────────┘
底部 tab：收件箱 / 集合 / 搜索 / 我的
```

- iPad 横屏（1024–1280）走两栏，阅读场景收益明显
- **三栏模式下点条目不跳页**，URL 变成 `?item=<id>`，刷新和分享都能恢复
- 分隔条宽度存 localStorage
- 侧栏可用 `[` 折叠为 64px 图标条

### 9.3 侧栏（信息架构）

```
┌─────────────────────────┐
│  ＋ 保存      ⌘K 搜索    │  ← 常驻顶部
├─────────────────────────┤
│  📥 收件箱            12 │  ← 唯一的"待整理"入口
│  📖 待读              34 │
│  🗂 全部条目             │
├─────────────────────────┤
│  集合              ＋    │
│  ▾ 公众号            87  │
│    └ 某某研究所      23  │  ← 二级，由 L1 规则自动建（§7.2）
│    └ 另一个号        18  │
│  ▸ 小红书            56  │
│  ▸ 抖音              12  │
│  ▸ 参考资料           9  │
├─────────────────────────┤
│  标签              ＋    │
│  #产品设计  #AI  #工具   │  ← chips 流式排列，>8 个折叠
├─────────────────────────┤
│  ⚙ 设置  📊 统计  🗑 回收站│
└─────────────────────────┘
```

- 集合树支持**拖拽排序、拖入移动**（Cubox 的核心手感，别省）
- 每项右侧显示计数，为 0 时置灰
- 未读加粗 + 角标；已读不加粗
- 标签点击是筛选，不是导航跳页

### 9.4 列表区

三种密度，默认比 Karakeep 松一档：

```
卡片模式（默认）
┌───────────────────────────────┐
│ ┌───────────────────────────┐ │
│ │      封面 16:9 / 缩略图     │ │  ← thumb 变体
│ └───────────────────────────┘ │
│ 标题最多两行，超出省略…        │
│ 摘要两行，字号 13，灰…         │
│ 公众号名 · 3 天前   #AI #产品  │
└───────────────────────────────┘

紧凑模式
┌────────────────────────────────────────────┐
│ 标题一行…                  公众号 · 3天前 #AI│
└────────────────────────────────────────────┘

网格模式（纯封面墙，适合图片类速记）
┌────┐┌────┐┌────┐┌────┐
└────┘└────┘└────┘└────┘
```

| 元素 | 规范 |
|---|---|
| 封面 | `thumb` 变体，`aspect-ratio: 16/9`，`object-fit: cover`；无图时用来源色块 + 平台图标 |
| 标题 | 2 行 clamp，15px / 500；**已读降为 60% 不透明度** |
| 摘要 | 2 行 clamp，13px，`--fg-muted` |
| 元信息 | 12px：来源名 · 相对时间 · 阅读时长 |
| 标签 | 最多 3 个，超出显示 `+2` |
| 状态角标 | 采集失败 → 左上红点；仅链接无正文 → 灰标"仅链接" |
| 悬浮 | 上浮 1px + 阴影加深，120ms |
| 多选 | `Shift+点击` 范围、`Cmd+点击` 加选；选中显示左侧 3px 强调色边 |

- 排序：收藏时间（默认倒序）/ 发布时间 / 阅读时长
- 顶部筛选条显示当前生效条件（来自智能集合或手选），可点 × 移除
- **虚拟列表必做**（`@tanstack/react-virtual`），1 万条靠它
- 分页用 cursor（§5.6）

### 9.5 阅读页

正文渲染细节见 §8.1、§8.2；这里只讲页面骨架。

```
┌────────────────────────────────────────────────────┐
│ ← 返回              标题（可点击编辑）   [原文 ↗] [⋯] │
│              公众号名 · 2026-11-20 · 3,200 字 · 8min │
├────────────────────────────────────────────────────┤
│                                                    │
│      正文区，最大宽度 68ch，居中                     │
│      中文 17–18px / 行高 1.8 / 段距 1em             │
│      图片圆角 8px，点击进全屏 lightbox（§8.2）        │
│                                                    │
│                              ┌────┐                │
│                              │ Aa │ ← 右侧浮动工具条 │
│                              │ ✎  │   字号/主题/高亮 │
│                              │ ☰  │   目录（M1）    │
│                              └────┘                │
├────────────────────────────────────────────────────┤
│ ▓▓▓▓▓▓░░░░░░░░░░░░░░░ 38%   ← 进度条（吸底）        │
└────────────────────────────────────────────────────┘
```

- `[原文 ↗]` 固定在标题行右侧，新窗口打开（§8.1）
- 沉浸模式：`F` 隐藏所有 chrome，只留正文
- 三栏模式下同一条目在右栏打开，**不打断列表滚动位置**
- 底部提供"上一条 / 下一条"（`J`/`K`），在集合内顺序导航 —— 追更场景的关键

### 9.6 设计语言（Design Tokens）

CSS 变量 + `data-theme`，一套 token 撑三种主题。

```css
:root {
  /* 间距：4px 基数 */
  --space-1: 4px;  --space-2: 8px;  --space-3: 12px;
  --space-4: 16px; --space-6: 24px; --space-8: 32px;

  /* 圆角 */
  --radius-card: 12px;
  --radius-btn: 8px;
  --radius-pill: 999px;

  /* 字体 */
  --font-ui:   -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
  --font-read: "Source Han Serif SC", "Songti SC", serif;   /* 可切无衬线 */

  /* 中文排版：比西文大一号、松一档，这点很关键 */
  --read-size: 18px;
  --read-line-height: 1.8;
  --read-para-gap: 1em;
  --read-max-width: 68ch;

  /* 动效 */
  --dur-fast: 120ms;
  --dur-base: 200ms;
  --ease: cubic-bezier(.2, .8, .2, 1);
}
```

| 项 | 决定 |
|---|---|
| 组件底座 | **shadcn/ui**（Radix 无样式 + 自建视觉），不被预设风格绑架 |
| 图标 | **Lucide**（线性、统一，气质接近 Cubox） |
| 强调色 | 默认墨青 `#0F766E`，可换；只用于选中态、链接、进度条 |
| 中性色 | 9 级灰阶；暗色不是简单反转，单独定一套 |
| 阴影 | 极轻：卡片 `0 1px 2px rgba(0,0,0,.06)`，浮层 `0 8px 24px rgba(0,0,0,.12)` |
| 主题 | 浅 / 深 / 护眼（米黄 `#FAF6EE`）；跟随系统 + 手动覆盖 |
| 暗色模式 | **Day 1 就要有**，不后补 |

#### 玻璃拟态的适用范围（v0.8 追加）

参考用户提供的一篇公众号文章的视觉风格。要落地必须理解两件事：

**① 玻璃的前提是"背后有东西可透"。** 纯色底上的半透明模糊只会像灰卡片。
所以先在 `body::before` 加了一层极淡的三色径向渐变（`--blob-1/2/3`，透明度 10–16%），
玻璃元素才有东西可透。这层是效果的一部分，不是装饰。

**② 只用于导航与浮层，绝不用于正文。** `backdrop-filter` 会降低文字对比度，
长文阅读时会发虚。所以：

| 用玻璃 | 保持不透明 |
|---|---|
| 侧栏、列表顶栏、阅读页吸顶栏 | **正文区**（iframe 内） |
| 粘贴框、图片 lightbox 工具条 | **列表卡片**（要扫读，必须清晰） |
| 主题切换器 | 设置页面板 |

**必须有降级**：

```css
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  /* 退回不透明，否则内容糊在背景上 */
}
@media (prefers-reduced-transparency: reduce) { /* 同上，并关掉光斑层 */ }
```

深色主题下玻璃用「白光薄涂」（`rgba(38,37,33,0.55)` + 1px 高光内阴影），
不要用白色半透明，否则整块发灰。

#### 阅读体验（v0.9）

| 能力 | 实现方式 | 关键取舍 |
|---|---|---|
| 字号 16/18/20/22 | 改 iframe 文档的 `--pb-font-size` CSS 变量 | **不重建 srcDoc** —— 重建会让 iframe 重新加载，滚动位置和已加载的图片全丢 |
| 行高 1.6/1.85/2.05 | 同上，`--pb-line-height` | 三档够了，再多用户选不过来 |
| 偏好持久化 | `localStorage['pb.reader.prefs']` | 不占服务端；隐私模式下写失败直接忽略 |
| 阅读进度 | 父窗口 scroll 比例 → 顶栏 2px 进度条 | 正文 iframe 被撑成内容全高，滚动的是外层窗口，所以不能用 iframe 的滚动 |
| 上一/下一篇 | 服务端按 `(savedAt, id)` 元组取邻居 | 只比时间会在"同一秒存两条"时卡住不动；`getNeighbors` 失败则静默降级为无翻页 |

阅读页键盘：`J`/`K` 翻页、`+`/`-` 字号、`E` 归档、`O` 开原文。

收件箱键盘流见 §9.7；实现上**不接管焦点**，只在卡片上加 `.is-focused` 类 ——
否则 Tab 键、右键「在新标签页打开」这些原生行为都会失效。

#### 标签与集合（v0.9，手动分类）

| 决策 | 做法 | 理由 |
|---|---|---|
| 打标签 | 回车即生效，服务端按名字 upsert（`tag.name` 唯一索引） | 不该先让用户去某个页面"创建标签"再用 |
| 空标签回收 | 解除最后一条引用时删掉 tag 行 | 否则侧栏越用越多空标签 |
| 集合删除 | FK `onDelete: set null`，条目不删 | 删文件夹不该删内容 |
| 集合层级 | schema 有 `parentId`，UI 只做一级 + 子级展示 | 个人使用两级够，多级树的移动/排序是另一个量级的工作 |
| 标签筛选 | `EXISTS` 子查询，不用 join | 一条目多标签时 join 会产生重复行，还得再 DISTINCT |
| 侧栏计数 | 一次 `group by` 查完，内存里配到集合上 | 避免每个集合一次 count |

**SQL 片段抽成纯函数**（`apps/web/lib/sqlFragments.ts`）并配 `.toSQL()` 断言：
本地没有 Postgres，`EXISTS` 子查询和元组比较这类"拼错了只在真库上炸"的代码
以前只能靠推上去试。现在至少能在 CI 里挡住参数丢失、cast 漏写、占位符错位。

#### 单条目操作（v0.9）

卡片右上角 `⋯` 与阅读页顶栏同一套菜单：重新抓取 / 归档·移回收件箱 /
标为待读 / 移到集合 ▸ / 删除。

| 决策 | 做法 | 理由 |
|---|---|---|
| 菜单位置 | 卡片外面包一层 `div.card-wrap`，菜单绝对定位在右上角 | `<button>` 不能是 `<a>` 的后代（HTML 非法），点击还会冒泡触发跳转 |
| 删除确认 | 点两次（第二次文案变红「确认删除（不可恢复）」） | 不用 `confirm()`：移动端弹窗丑、还阻塞整页 |
| 键盘删除 | 连按两次 `D`（1 秒内） | 不可恢复的操作用单键太容易误触 |
| 集合列表 | 第一次展开菜单时才拉 | 否则每张卡片都要发一次请求 |
| 删除顺序 | 先取 storageKey → 删行 → 再删文件 | 反过来做，中途失败会留下"库无记录、盘有文件"的孤儿，谁也发现不了 |
| 文件删不掉 | 不阻断删除，返回里带 `filesFailed` | 否则用户看到"删不掉"却无从处理；孤儿文件留给清理任务扫 |

速记没有来源链接，「重新抓取」对它是禁用的。

#### 回收站、多选、筛选、搜索（v1.0）

**回收站用软删除**：`item.status` 新增枚举值 `trashed`，配 `trashed_at` 时间戳。

| 决策 | 做法 | 理由 |
|---|---|---|
| 为什么不加 `deleted_at` 列 | 加枚举值，复用现有 `status` 过滤 | 所有列表查询本来就按 status 走；再加一列等于每条查询都要记得加 `and deleted_at is null`，迟早漏 |
| 默认排除 | `listItems` 里统一处理：`status='all'` 时强制 `status <> 'trashed'` | 规则收在一处，页面不用各记一遍 |
| 何时真删 | 只有回收站里能调 `?purge=1` / `batch(purge)` | 误调用批量接口不会把正常条目抹掉 |
| 批量为什么一条接口 | `POST /api/v1/items/batch`，`UPDATE ... WHERE id = ANY(...)` | 前端循环发 N 个请求会半途失败，列表和实际对不上 |
| 侧栏「全部条目」计数 | 不含回收站 | 否则删了东西数字不变，用户会困惑 |

**多选**：勾选框在卡片外层绝对定位（不能放进 `<a>`，原因同上），
选中状态由 `ItemList` 统一持有 —— 全选/批量操作需要知道整体状态。
批量操作条固定在视口底部，滚动时始终可见。

**筛选**：`/inbox?source=xhs` 这类 URL 参数驱动，服务端渲染；
筛选可分享、可后退。

**搜索**：

```sql
(search_text <> '' AND to_tsvector('simple', search_text) @@ plainto_tsquery('simple', $q))
 OR title ILIKE $pattern
 OR content_text ILIKE $pattern
 OR excerpt ILIKE $pattern
```

三条路都要，因为各覆盖一半场景：

- FTS 依赖 jieba 预分词的 `search_text`——**速记的 search_text 是空的**
  （web 侧没有 jieba），所以速记只能靠子串匹配
- trigram/ILIKE 能命中任意中文子串，配 `gin_trgm_ops` 索引（`content_text` 新加）
- 用 OR 合并而不是二选一：**宁多不漏**，搜不到比搜出几条无关的更糟

ILIKE 的 `%` `_` 必须转义，否则用户输入一个 `%` 就变成全表匹配。

#### 公众号「图片消息」（v1.1）

公众号有两种消息类型，正文结构完全不同：

| 类型 | 结构 | 处理 |
|---|---|---|
| 图文消息 | `#js_content` 里有段落 | 原有逻辑 |
| **图片消息** | 正文是一组图片，**没有 `#js_content`** | 走图片分支，`type='image'` |

图片消息的识别用三层，从精确到宽松：

1. `#js_image_content` / `.image-list` / `.image_content` → `kind='image-post'`
2. 结构变了但页面里有 ≥3 张图 → `kind='image-post-fallback'`
3. 都没有 → 交给 generic，而 generic 在"没有正文容器 + ≥3 张图"时按图集录入（`kind='gallery'`）

**门槛为什么是 3 张**：头图、头像、二维码通常只有 1–2 张，3 张能有效排除；
worker 那边还会按"源图 <120px"再过滤一次，双重保险。

2026-11-27 真机：`mp.weixin.qq.com/s/hQPHsxp75jp5v6MDMRTPIQ` 这种图片消息
两个 adapter 都解析不出，最后成了一张"无标题"的空卡片（提示
`adapter: wechat → generic`）。这条链路现在有 11 项断言守着。

#### 公众号「图片消息」（v1.1）

公众号有两种消息类型，正文结构完全不同：

| 类型 | 结构 | 处理 |
|---|---|---|
| 图文消息 | `#js_content` 里有段落 | 原有逻辑 |
| **图片消息** | 正文是一组图片，**没有 `#js_content`** | 走图片分支，`type='image'` |

识别用三层，从精确到宽松：

1. `#js_image_content` / `.image-list` / `.image_content` → `kind='image-post'`
2. 结构变了但页面里有 ≥3 张图 → `kind='image-post-fallback'`
3. 都没有 → 交给 generic；generic 在"没有正文容器 + ≥3 张图"时按图集录入（`kind='gallery'`）

**门槛为什么是 3 张**：头图、头像、二维码通常只有 1–2 张，3 张能有效排除；
worker 还会按"源图 <120px"再过滤一次，双重保险。

2026-11-27 真机：`mp.weixin.qq.com/s/hQPHsxp75jp5v6MDMRTPIQ` 这种图片消息
两个 adapter 都解析不出，最后成了一张「无标题」空卡片（提示 `adapter: wechat → generic`）。
这条链路现在有 20 项断言守着。

#### 无头浏览器（v1.2，可选容器）

**动机**：越来越多站点的正文是前端渲染的，服务端拿到的 HTML 只是空壳。
2026-11-27 实测同一篇文章：

| 来源 | HTML | `<img>` | `#js_content` |
|---|---|---|---|
| 服务端 fetch | 31KB | 0 | 无 |
| 浏览器（用户截图） | — | 6 张 | 有 |

`vite-legacy-*` 标记说明它是个 JS 壳。再加兜底也没用——必须真的执行 JS。

**架构**：单独的可选容器 `pb-browser`，只做一件事：给 URL，返回渲染后的 HTML。

```
worker ──(普通抓取失败)──▶ pb-browser /render ──▶ 渲染后 HTML
   │                                              │
   └──────── 用这份 HTML 重跑 adapter 管线 ◀───────┘
```

| 决策 | 原因 |
|---|---|
| 只在失败后调用，不预先渲染 | 渲染 2–5 秒；公众号图文、普通网页直接 fetch 就够 |
| 用 Debian 自带 chromium，不用 playwright 官方镜像 | 后者 1.9GB，前者约 400MB；这里只需要能跑 JS |
| 独立容器 + `profiles: ['browser']` | 不用的人不必多拉 400MB |
| `BROWSER_URL` 留空即禁用 | 失败时行为与以前完全一致，不影响现有部署 |
| 连续失败 3 次熔断 5 分钟 | 否则浏览器挂了以后每条抓取都白等 30 秒 |
| `shm_size: 512mb` | Chromium 吃 /dev/shm，默认 64MB 会直接崩 |
| 渲染超时 25s、并发 1 | N100 上并行渲染只会互相拖慢，而这是后台任务 |

**已知局限**：站点可能识别 `navigator.webdriver`。已加
`--disable-blink-features=AutomationControlled` 与真实 UA，但这不是万能的；
被拦时仍退回「仅保存链接」，这种情况下浏览器扩展才是可靠路径。

自检 `scripts/check-browser.mts`（14 项）用 stub fetch 覆盖：
未配置时不发请求、成功/失败/HTML 过短、熔断后不再发请求、网络异常不抛错。

**哪些站点走浏览器**（v1.3）：

| 模式 | 站点 | 原因 |
|---|---|---|
| **直接走浏览器** | 小红书、抖音、知乎、Instagram、Facebook、Threads、X | 服务端 HTML 是空壳或有反爬，先 fetch 是白费一次请求 |
| **失败后再走浏览器** | 其它所有站点 | 公众号图文、普通网页直接 fetch 就够，渲染一次要 2–5 秒 |
| 不走浏览器 | 客户端送 HTML（扩展 / 粘贴正文） | 那已经是最好的输入 |

> 需要**登录**的站点（Instagram / Facebook / X）即使渲染也只能拿到登录墙，
> 必须在设置页配站点凭据（Cookie），浏览器会把 Cookie 注入上下文。

通用 adapter 的正文选择器同步做了扩充（知乎 `.Post-RichText`、
cnbeta `.article-content`、GitHub `article.markdown-body` 等）。
另外把"命中明确选择器"的字数门槛从 200 降到 80 —— 那些选择器本身就是
强信号，要求 200 字会把短文章（知乎回答、README 摘要）整条漏掉；
只有靠"段落最多"启发式时才保留 200 的门槛。

自检 `packages/core/test/sites.check.ts`（13 项）覆盖知乎 / cnbeta / GitHub
三种真实结构的抽取，以及"登录墙不该被当成正文"的负例。

#### 双栏预览（v1.0）

宽屏（≥1280px，右栏存在）时：**单击卡片 → 右栏预览，双击 → 独立阅读页**。
窄屏保持原来的行为（单击直接跳转），因为那时右栏根本不存在。

| 决策 | 做法 | 理由 |
|---|---|---|
| 状态放哪 | `WorkspaceProvider` 包住两栏，`ListPage` 因此变成客户端组件 | 选中项来自列表点击、被右栏消费，必须活在共同祖先 |
| 怎么判断宽屏 | `matchMedia('(min-width: 1280px)')` 在客户端测 | 服务端不知道视口宽度；首帧 `wide=false`，此时单击按默认行为跳转，不会出现"点了没反应" |
| 单击还是双击 | 单击 `preventDefault()` 后只选中；双击 `router.push` | 浏览列表时不该每点一下就整页跳走 |
| 修饰键 | `metaKey/ctrlKey/shiftKey/altKey` 时**不拦** | 用户想开新标签页，拦住就是添乱 |
| 预览请求 | 只拉选中那一条，带 `AbortController` | 快速连点时后发的请求可能先回来，导致右栏内容和高亮不一致 |
| 键盘 | 宽屏下 `J/K` 同时移动焦点与预览 | feed 阅读器的习惯；`Enter` 仍然进独立页 |

`detail-pane` 的断点是 1280px（三栏布局），所以"宽屏"判定必须与 CSS 一致，
不能各写一个数值。

#### 修改登录密码（v1.0）

设置页「登录密码」：当前密码 + 新密码 + 确认，调 `POST /api/v1/auth/password`。

| 决策 | 做法 | 理由 |
|---|---|---|
| 为什么要输当前密码 | 必须验证，只有 cookie 不够 | cookie 一旦泄露，攻击者能直接改密码把主人锁在外面 |
| 改完之后 | `sessionEpoch + 1`，并清掉当前 cookie | 见下 |
| 忘记密码 | 删 `data/config/auth.json` 后重启 | 文件里只有 scrypt 哈希，删了就重新生成并打印日志 |

**sessionEpoch 是这次的关键改动。** JWT 用 `AUTH_SECRET` 签名，与密码无关——
所以原来「改密码」只换了登录凭据，**已经签发的 cookie 还能继续用 30 天**。
而改密码最常见的动机恰恰是怀疑凭据泄露，那样等于白改。

现在 token 里带 `ep` 声明，校验时与 auth.json 里的 `sessionEpoch` 对比：

- 改密码 → 代次 +1 → 所有旧 token 立即失效（含当前这个，所以要重新登录）
- 删掉 auth.json 重建 → 代次取**随机数**而不是 0，避免新旧文件代次都是 0 让旧 token 复活
- 本次升级前签发的 token 没有 `ep`，一律失效，强制重新登录一次

#### 右栏滚动的两个坑（v1.0.1）

**① `.detail-pane` 必须有 `min-height: 0`**

flex 子元素默认 `min-height: auto`，不写 0 就收缩不到内容以下 →
整栏被长正文撑高 → `overflow-y: auto` 永远不触发 → 没有滚动条、滚轮也没反应。
（短文章看起来正常、长文章就"滚不动"，症状正是如此。）

**② iframe 内的滚轮不冒泡**

鼠标停在正文上时，滚轮事件进的是 iframe 自己的文档。而我们把 iframe
撑成了内容全高、它内部没有可滚动区域 —— 事件滚不动任何东西，也不会传到外层。
表现就是「有滚动条，但滚轮完全没反应」。

解法：在 iframe 文档里监听 `wheel`（`passive: false`），手动滚
**最近的可滚动祖先**（只认 `overflow-y: auto/scroll` 且内容确实超出的元素，
否则会误抓没滚动的包装层）。找不到祖先时滚窗口 —— 独立阅读页就是这种情况。
到顶/到底时把剩余滚动放给页面，避免"卡住不动"。

#### 图标与 PWA 清单（v1.1）

| 文件 | 位置 | 用途 |
|---|---|---|
| `favicon.ico` / `favicon-16x16.png` / `favicon-32x32.png` | `apps/web/public/` | 浏览器标签页 |
| `apple-touch-icon.png`（180） | 同上 | iOS 添加到主屏幕 |
| `android-chrome-192x192.png` / `-512x512.png` | 同上 | PWA / Android |
| `logo.png`（界面品牌位） | 同上 | 侧栏与登录页的标志 |
| `manifest.webmanifest` | `app/manifest.ts` **动态生成** | PWA 清单 |
| `icon-32.png` / `icon-192.png` | `apps/extension/` | 扩展工具栏图标 |

界面的品牌位（侧栏 `BrandMark`、登录页）用 `logo.png` 位图，
**不再把应用名首字渲染成方块** —— 浏览器标签、手机主屏、界面里应该是同一个标志。
直接用 192px 版本缩放到 26/28px：浏览器缩图质量足够，2x/3x 屏也清晰；
单独切一张 26px 的反而在高分屏会糊。

**为什么是重绘而不是抠原图**：源图里书签边缘有一圈与白卡片混合的浅色描边，
还有投在卡片上的柔和阴影。这两样和本体在空间上纠缠，腐蚀/解混都只能去掉一部分，
缩到 16–32px 始终带脏边（试过洪水填充、渐变背景模型、边缘腐蚀、反解混四轮）。

最后按几何重绘：形状与配色取自原图实测（书签 264×412，宽高比 0.641；
青绿渐变 `#279C9A → #1A737B`；加号白色圆头，中心在 30% 高处）。
画在 4 倍画布再缩下来，得到真抗锯齿。

小尺寸（favicon 16/32、`logo.png`）用**书签本体**；PWA/iOS 图标用同一标志
放在 `--bg` 浅色底上、四周留 14% 安全区（maskable 要求）。

**清单为什么要动态生成**：应用名来自 `APP_NAME` 环境变量。
静态 `site.webmanifest` 里的 `name` 是写死的，改 `APP_NAME` 之后
装到手机桌面上会显示成空名字或旧名字。

`theme_color` / `background_color` 与 `globals.css` 的 `--accent` / `--bg` 对齐；
启动画面不会闪一个别的颜色。

中间件必须放行这些静态资源：**未登录时浏览器也会去请求 favicon**，
拦掉的话控制台一片红，PWA 也装不上。

放行规则是两条：显式清单 + `根路径下图片扩展名`（`/logo.png` 这类）。
**登录页也在用 logo.png**，如果只按清单放行，新加的图会静默变成 302 →
登录页的 logo 直接裂图（真踩过：`/logo.png` 返回 `text/html` 而不是 `image/png`）。

移动端地址栏配色用 `export const viewport: Viewport`（Next 15 要求
`themeColor` 不能放在 `metadata` 里），并给浅色/深色各一档。

### 9.7 关键页面清单

| 路由 | 页面 | 参考 | 交付 Sprint |
|---|---|---|---|
| `/` | → 重定向 `/inbox` | | S0 |
| `/login` | 登录 | | S0 |
| `/inbox` | 收件箱 | Cubox | S0 空壳 / S3 完整 |
| `/item/[id]` | 阅读页 | Karakeep | S1 |
| `/collection/[id]` | 集合视图 | Cubox | S3 |
| `/tag/[name]` | 标签视图 | | S3 |
| `/search` | 搜索 | | S3 |
| `/quick` | 粘贴即存（移动入口） | | S4 |
| `/settings/*` | 设置（令牌/主题/规则/AI） | | S0 起 |
| `/stats` | 统计 | | M2 |

### 9.8 移动端特化

| 项 | 决定 |
|---|---|
| 导航 | 底部 4 tab：收件箱 / 集合 / 搜索 / 我的 |
| 保存入口 | 右下 FAB `＋` → 展开「粘贴链接 / 写速记 / 上传图片」 |
| 返回手势 | 交给 history 手势，不自己造轮子 |
| 安全区 | `env(safe-area-inset-*)`，底部 tab 必须适配 |
| 列表 | 固定卡片模式，不提供密度切换（小屏切换没意义） |
| 阅读 | 默认全屏沉浸，点中部唤出 chrome |
| 图片 | 长按保存（原生），lightbox 支持下滑关闭 |

### 9.9 空状态 / 加载 / 错误

| 场景 | 处理 |
|---|---|
| 首次进入（0 条） | 大号提示「粘贴一个公众号链接试试」+ 一键复制示例 + 扩展安装引导 |
| 列表加载 | **骨架屏**（3–5 个灰卡片），不用转圈 |
| 采集进行中 | 列表顶部插一条"处理中"卡片，带阶段文案（抓取 → 下载图片 3/6 → 索引） |
| 采集失败 | 卡片红边 +「仅保存了链接」+ 重试按钮 |
| 图片加载失败 | 按原尺寸比例留占位块，**不塌陷布局** |
| 搜索无结果 | 提示可切「语义搜索」（M2） |

### 9.10 实现约束

- 布局用 **CSS Grid**（`grid-template-columns: 240px 400px 1fr`），不拿 flex 硬拼
- 拖拽分隔条用 `pointer-events`，宽度存 localStorage
- URL 状态用 **nuqs**（筛选/排序/选中项都在 URL 里，刷新与分享不丢）
- 列表虚拟化 `@tanstack/react-virtual`
- 图标按需引入（`lucide-react` 可 tree-shake）
- 所有可交互元素有 `:focus-visible` 样式 —— 这是键盘流（§7.5）的前提
- 颜色对比度 ≥ 4.5:1（WCAG AA）

---

## 10. 部署

### 10.1 docker-compose.yml

```yaml
name: personal-bookmark

services:
  pb-db:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_DB: bookmark
      POSTGRES_USER: bookmark
      POSTGRES_PASSWORD: ${DB_PASSWORD:?required}
      TZ: Asia/Shanghai
    command: >
      postgres
      -c shared_buffers=512MB
      -c effective_cache_size=2GB
      -c max_connections=50
      -c work_mem=16MB
    volumes:
      - ./data/db:/var/lib/postgresql/data
    shm_size: 256mb
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U bookmark -d bookmark"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  pb-web:
    image: ghcr.io/CHANGE_ME/personal-bookmark-web:${TAG:-latest}
    environment:
      DATABASE_URL: postgres://bookmark:${DB_PASSWORD}@pb-db:5432/bookmark
      APP_NAME: ${APP_NAME:-个人bookmark}
      AUTH_SECRET: ${AUTH_SECRET:?required}
      ASSETS_DIR: /data/assets
      CONFIG_DIR: /data/config
      PUBLIC_BASE_URL: ${PUBLIC_BASE_URL:-http://localhost:3000}
      # 「预览原图」按需回源（见 ADR-013）
      MAX_SOURCE_BYTES: ${MAX_SOURCE_BYTES:-33554432}
      SOURCE_FETCH_TIMEOUT_MS: ${SOURCE_FETCH_TIMEOUT_MS:-15000}
      SOURCE_CACHE_ITEMS: ${SOURCE_CACHE_ITEMS:-50}
    ports:
      - "${WEB_PORT:-3000}:3000"
    volumes:
      - ./data/assets:/data/assets
      - ./data/config:/data/config
    depends_on:
      pb-db: { condition: service_healthy }
    restart: unless-stopped

  pb-worker:
    image: ghcr.io/CHANGE_ME/personal-bookmark-worker:${TAG:-latest}
    environment:
      DATABASE_URL: postgres://bookmark:${DB_PASSWORD}@pb-db:5432/bookmark
      ASSETS_DIR: /data/assets
      DEEPSEEK_API_KEY: ${DEEPSEEK_API_KEY:-}
      LLM_BASE_URL: ${LLM_BASE_URL:-https://api.deepseek.com}
      LLM_MODEL: ${LLM_MODEL:-deepseek-chat}
      CONCURRENCY: ${WORKER_CONCURRENCY:-3}
      DISPLAY_MAX_EDGE: ${DISPLAY_MAX_EDGE:-2000}
      DISPLAY_WEBP_QUALITY: ${DISPLAY_WEBP_QUALITY:-85}
      MAX_ASSET_BYTES: ${MAX_ASSET_BYTES:-20971520}
    volumes:
      - ./data/assets:/data/assets
    depends_on:
      pb-db: { condition: service_healthy }
    restart: unless-stopped

  # 可选：需要动态页/截图时手动启用
  # docker compose --profile browser up -d
  pb-browser:
    image: mcr.microsoft.com/playwright:v1.48.0-jammy
    profiles: ["browser"]
    command: ["node", "/app/server.js"]
    volumes:
      - ./apps/worker/browser-server:/app
    environment:
      BROWSER_TOKEN: ${BROWSER_TOKEN:-}
    restart: unless-stopped
```

**注意：compose 里没有 PUID/PGID。** 原因：官方 `postgres` 和 Node 镜像都不认这两个变量。改法是在 `.env` 里设 `ASSETS_UID/ASSETS_GID`，容器以 `user: "${ASSETS_UID}:${ASSETS_GID}"` 启动，并在 Dockerfile 里 `chown` 好目录。绿联的默认用户通常是 `1000:1000`（用 SSH 跑 `id` 确认）。

### 10.2 环境变量表

| 变量 | 必填 | 默认 | 说明 |
|---|---|---|---|
| `DB_PASSWORD` | ✅ | — | Postgres 密码，随机生成 |
| `AUTH_SECRET` | ✅ | — | JWT 签名密钥，32+ 随机字符 |
| `APP_NAME` | | `个人bookmark` | UI 显示名（ADR-008） |
| `PUBLIC_BASE_URL` | | `http://localhost:3000` | 生成分享链接、PWA 用 |
| `WEB_PORT` | | `3000` | 宿主机端口，避开 80/443 |
| `ASSETS_DIR` | | `/data/assets` | 资源根目录 |
| `DEEPSEEK_API_KEY` | | 空 | 空则关闭 L3 |
| `LLM_BASE_URL` | | `https://api.deepseek.com` | OpenAI 兼容端点 |
| `LLM_MODEL` | | `deepseek-chat` | |
| `EMBEDDING_ENABLED` | | `true` | 关掉则不做语义检索 |
| `WORKER_CONCURRENCY` | | `3` | N100 四核，3 足够 |
| `MAX_HTML_BYTES` | | `8388608` | 单页 HTML 上限 |
| `MAX_ASSET_BYTES` | | `20971520` | 采集时单张图上限 |
| `FETCH_TIMEOUT_MS` | | `20000` | |
| `DISPLAY_MAX_EDGE` | | `2000` | display 变体长边上限（唯一长期副本，别调太低） |
| `DISPLAY_WEBP_QUALITY` | | `85` | display 的 webp 质量 |
| `MAX_SOURCE_BYTES` | | `33554432` | 「预览原图」单张上限，超出中断 |
| `SOURCE_FETCH_TIMEOUT_MS` | | `15000` | 回源超时 |
| `SOURCE_CACHE_ITEMS` | | `50` | 回源内存 LRU 张数，`0` 关闭 |
| `DOUYIN_DOWNLOAD_VIDEO` | | `false` | 视频本体下载开关 |

### 10.3 绿联 DXP4800 部署步骤

> 详细版见 `docs/deploy-ugreen.md`，这里是骨架。

**① 准备**

```bash
# 控制面板 → 终端机 → 启用 SSH（端口 22）
ssh 你的账号@NAS_IP
id          # 记住 uid/gid，通常 1000:1000
docker --version
```

**② 目录**

```bash
sudo mkdir -p /volume1/docker/personal-bookmark/data/{db,assets,config}
sudo chown -R 1000:1000 /volume1/docker/personal-bookmark/data
cd /volume1/docker/personal-bookmark
```

> **DB 放 NVMe 提速**：DXP4800 有 2 个 M.2 位。若已组 NVMe 存储池（如 `/volume2`），把 `./data/db` 换成 `/volume2/bookmark-db/db`，assets 留在 HDD。收益：随机 IO 明显更顺。

**③ 生成密钥**

```bash
echo "DB_PASSWORD=$(openssl rand -base64 24)"
echo "AUTH_SECRET=$(openssl rand -base64 32)"
# 写入 .env，同时设 APP_NAME / WEB_PORT
```

**④ 起服务（两种方式，选一）**

- **图形界面**：Docker 应用 → 【项目】→【创建】→ 粘贴 compose → 自动读取同目录 `.env`
- **SSH（推荐，便于看日志）**：`docker compose up -d && docker compose logs -f pb-web`

**⑤ 首启**

- 无密码时自动生成，**打印到 `pb-web` 日志**：`docker compose logs pb-web | grep "初始密码"`
- 自动跑迁移

**⑥ HTTPS（PWA 必需）**

Service Worker / 主屏安装都要求 secure context，`http://192.168.x.x` 装不上。三条路，按推荐排序：

| 方案 | 优点 | 操作 |
|---|---|---|
| **Tailscale（最推荐）** | 免费 HTTPS 域名、不暴露公网、证书零配置 | 装 tailscale 容器 → `tailscale serve --bg 3000` → 得到 `https://xxx.ts.net` |
| Caddy 容器 + 域名 | 需有域名 + DNS | `caddy reverse-proxy --from bookmark.example.com --to pb-web:3000` |
| 绿联自带反代 | 无新容器 | 视固件版本，能力有限 |

**⑦ 镜像加速**

Docker → 设置 → 加速器，配 2–3 个稳定地址（[绿联支持 10 个](https://www.ugnas.com/play-detail/id-68.html)）。另外 release 里提供 `docker save` 的 tar 包，`docker load -i xxx.tar` 兜底。

**⑧ 备份**

```bash
# scripts/backup.sh
docker compose exec -T pb-db pg_dump -U bookmark -Fc bookmark > backup/db-$(date +%F).dump
tar czf backup/assets-$(date +%F).tar.gz -C data assets
# 保留最近 14 份
```

接到 UGOS 任务计划，或让 Hyper Backup 直接备份整个 `./data` 目录（`db` 目录需先 `pg_dump`，不可热备）。

### 10.4 首次启动的自动化

| 动作 | 实现 |
|---|---|
| 跑迁移 | 容器 entrypoint 里 `drizzle migrate` |
| 建管理员密码 | 若 `./data/config/auth.json` 不存在 → 生成 + 打日志 + 写文件。密码来源优先级：已有文件 > `ADMIN_PASSWORD` 环境变量 > 随机生成。**触发时机是登录页渲染时**（不是进程启动）——Next 的 `instrumentation.ts` 会同时打进 Edge 运行时，`node:fs` 在那里不被允许，构建直接失败。 |
| seed 内置规则 | 幂等 upsert（按 `rule.name` 判重） |
| seed 默认集合 | `公众号 / 小红书 / 抖音 / 待读` |
| 建扩展 | `CREATE EXTENSION IF NOT EXISTS vector, pg_trgm` |

### 10.5 安全基线

- 仅 web 端口对外，db 不映射宿主端口
- 图片资源**不走用户可控 URL 拼接**，只认 assetId（防路径穿越）
- iframe `sandbox=""`（无 `allow-scripts`）
- PAT 存 hash，前缀明文展示
- 上传校验 `content-type` 白名单 + `sharp` 解码失败即拒（防伪装文件）
- 登录限流：同 IP 5 次/分钟

---

## 11. M0 任务拆分

> 排序原则：**按"哪天开始能用"排，不按模块排**。单人项目的死法是三周后放弃，所以第一个里程碑必须是"能替代 Cubox 存公众号"。

### Sprint 0｜地基（D1–D2）

| # | 任务 | 产出 |
|---|---|---|
| T0.1 | pnpm monorepo 骨架 | `pnpm-workspace.yaml`、`apps/*`、`packages/*`、tsconfig base |
| T0.2 | docker-compose + Dockerfile（web/worker） | 本地三条命令起来 |
| T0.3 | Drizzle schema + 首个迁移 + 手写 SQL（扩展/索引） | `packages/db/migrations/` |
| T0.4 | 认证：登录页 + session cookie + PAT 管理 | `/login`、`/settings/tokens` |
| T0.5 | 设计令牌 + 主题（浅/深/护眼） | `globals.css` 里落 §9.6 的 CSS 变量，`data-theme` 切换 |
| T0.6 | 布局壳 + 空列表页 | 按 §9.2 三档断点搭 Grid 骨架：侧栏（§9.3）+ 列表区（§9.4）+ 空状态（§9.9） |

**DoD**：`pnpm dev` 起来三层，能登录，进入空的 Inbox（三栏骨架 + 三种主题可切），能用 curl + PAT 打 `/api/v1/items` 返回 `[]`。

---

### Sprint 1｜打通公众号（D3–D5）★ 最关键

| # | 任务 | 产出 |
|---|---|---|
| T1.1 | `core/url.ts`：规范化 + 平台识别 | 单测覆盖微信 `__biz/mid/idx/sn` 规则 |
| T1.2 | `core/fetcher.ts`：undici 封装 | UA/Referer 注入、超时、重试、大小上限、限流 |
| T1.3 | `adapters/wechat.ts` | `#js_content` + `data-src` 优先 + JS 变量抽 title/author/ct/cover |
| T1.4 | `adapters/generic.ts` | jsdom + Readability 兜底 |
| T1.5 | 图片管线（两档变体） | 下载 → sha256 去重 → **源文件只进 /tmp** → 派生 display(≤2000 q85, 剥 EXIF) + thumb(400w q75) → **派完删源**；必写 `origin_url`/`origin_referer`/`sourceBytes`；动图例外 |
| T1.6 | `core/sanitize.ts` | img src 重写为 assetId；保留 inline style；剥 script/iframe/on* |
| T1.7 | 阅读页 `/item/[id]` | iframe srcdoc + 排版变量 + 暗色 + 图片两级懒加载 + **全屏 lightbox 与「预览原图」（按需回源、失败降级）** + **`[原文 ↗]` 新窗口打开** |
| T1.8 | `GET /assets/:id/source` 回源端点 | 带 `origin_referer`/UA 拉取、流式转发、内存 LRU、**SSRF 防护（拒私有网段）+ 大小/超时/限流** |
| T1.9 | 粘贴框保存 → 入队 → 轮询状态 | 顶部全局"保存"输入框 |

**DoD（本项目的生死线）**：
> 粘一个真实公众号链接 → **30 秒内** → 出现完整正文 + **全部图片正常显示** → iPhone Safari 上打开也能正常阅读 → 点图片能全屏、按「预览原图」能拉到原图。

到这里，需求 1 已经满足，可以开始弃用 Cubox。

---

### Sprint 2｜富化采集（D6–D8）

| # | 任务 | 产出 |
|---|---|---|
| T2.1 | capture API 三档语义 + zod 校验 | 按完整度自动选路 |
| T2.2 | 资源两段式上传（upload-url / commit） | `Storage` 接口 + LocalDisk 实现 |
| T2.3 | MV3 扩展骨架：popup + background + content | 一键保存当前页 |
| T2.4 | 扩展抓图（**必须在 Service Worker 里 fetch**） | `host_permissions` + `declarativeNetRequest` 改 Referer |
| T2.5 | 扩展页面内提取 | `#js_content` outerHTML + 真图地址列表 |
| T2.6 | 去重：canonical_url 精确 + simhash 近似 | 命中返回 409 + `existingItemId`，UI 提示"已收藏过" |

**DoD**：扩展一键保存，与"粘贴路径"产生同样完整的结果；重复保存同一篇会提示而非新建。

---

### Sprint 3｜组织与检索（D9–D11）

| # | 任务 | 产出 |
|---|---|---|
| T3.1 | 集合树 CRUD + 拖拽排序 | 侧栏树（§9.3），拖拽移动 + 计数徽标 |
| T3.2 | 标签 CRUD + 按标签筛选 | chips 编辑与筛选 |
| T3.3 | Inbox 键盘流 | `j/k/space/t/c/a/x/u/?`（§7.5） |
| T3.4 | 全文搜索 | jieba 写入 `search_text` + tsvector GIN + pg_trgm |
| T3.5 | 批量操作 | 多选 → 设集合/加标签/归档 |
| T3.6 | L1 规则引擎 + 内置微信按账号分子集合 | seed 4 条默认规则 |
| T3.7 | 列表三密度 + 虚拟滚动 + 筛选条（URL 态） | 卡片/紧凑/网格（§9.4），nuqs 同步到 URL |

**DoD**：1000 条数据下，关键词搜索 **< 200ms** 出结果；存第 2 个公众号文章时自动落到 `公众号/<账号名>` 子集合。

---

### Sprint 4｜移动端（D12–D14）

| # | 任务 | 产出 |
|---|---|---|
| T4.1 | PWA：manifest + service worker + 离线壳 | 可"添加到主屏幕" |
| T4.2 | 粘贴即存页（读剪贴板，一键保存） | `/quick` |
| T4.3 | 设置页生成 PAT + iOS 快捷指令图文说明 | 附 `.shortcut` 下载 |
| T4.4 | 划词高亮（四元组定位） | 选中 → 弹色板 → 存 |
| T4.5 | 阅读进度 + 已读状态自动判定 | scrollRatio + 停留时长 |
| T4.6 | 移动端原图体验 | 长按保存、lightbox 手势关闭、弱网超大原图二次确认 |
| T4.7 | 移动端导航骨架 | 底部 4 tab + FAB 保存入口 + 安全区适配（§9.8） |
| T4.8 | 三栏模式与阅读页打磨 | 分隔条拖拽、`?item=` 内联阅读、沉浸模式 `F`、`J/K` 上/下条 |

**DoD**：iPhone 上从微信复制链接 → 打开 PWA → **2 次点击**存完，且文章可离线打开。

---

### Sprint 5｜收尾（D15）

| # | 任务 |
|---|---|
| T5.1 | 备份/恢复脚本 + 文档 |
| T5.2 | Markdown + 资源包导出 |
| T5.3 | `docs/deploy-ugreen.md` 完整手册 + 首启引导 |
| T5.4 | 空状态 / 错误态 / 加载骨架打磨 |
| T5.5 | 删除条目时的资源 GC 任务 |

**M0 总完成标准（可交付给自己日常使用）**
1. 公众号：正文 + 图片 100% 完整，手机可读
2. 小红书/抖音：能存，有封面和文案
3. 速记：能写文字贴图片
4. 分类：自动落集合（规则）+ 手动打标签
5. 检索：中文关键词能搜到
6. 部署：绿联上一键起，含备份

---

## 12. 容量与性能预算

### 12.1 1 万条目存储估算

按 ADR-013 的两档变体算（**只存压缩图，原图不落盘**）：

| 项 | 单条 | × 1万 | 备注 |
|---|---|---|---|
| `content_html` | ~80 KB | 800 MB | 公众号 inline style 多 |
| `content_text` + `search_text` | ~12 KB | 120 MB | |
| `snapshot.raw_gz` | ~20 KB | 200 MB | 压缩后 |
| 元数据 + 索引 | ~8 KB | 80 MB | |
| **Postgres 合计** | | **~1.2 GB** | |
| **display** webp ≤2000 q85（6 张 × 150KB） | ~900 KB | **9 GB** | 唯一长期副本，参数调高保清晰度 |
| **thumb** webp 400 q75（6 张 × 15KB） | ~90 KB | 0.9 GB | |
| **assets 合计** | | **~9.9 GB** | |
| **总计** | | **≈ 11 GB** | 16GB 内存的机器压力为零 |

> **取舍说明**：原图不落盘，省掉约 15GB。代价是「预览原图」必须在源站还活着时才能用——公众号删文后原图就永久拿不到了，只剩压缩图。
>
> 这个取舍是用户主动选的，而且方向是对的：**压缩图已经保住了"能读、能看"这个核心价值**，原图是锦上添花。需要反悔时成本也很低——把 `asset_variant` 的枚举加回 `original`，新采集的图开始留原图即可，老数据不受影响。
>
> **敏感性提醒**：如果存的多是 20 张图的长图文，实际可能到 25~30GB。以 `/api/v1/stats` 的实际统计为准，不要依赖估算。

### 12.2 N100 性能预算

| 操作 | 单次 | 全量 1 万 | 结论 |
|---|---|---|---|
| jieba 分词 | ~1 ms | 10 s | 无感 |
| sharp → webp | 100–200 ms/张 | ~30 min（6万张） | 采集时逐张，不阻塞 |
| bge-small ONNX (int8) | 30–60 ms | **~10 min** | 可随时换模型重跑 |
| DeepSeek 打标（10/批） | 3–5 s/批 | **~1.5 h，¥30–60** | 只增量跑，不重跑 |
| 全文检索查询 | 5–20 ms | — | |

> 关键结论：**所有"重算"都在"泡杯茶"级别**。这是刻意设计的——它给你随意升级解析器/换模型的自由，而这正是这类工具长期可维护的核心。

### 12.3 内存预算（运行时）

| 进程 | 常驻 |
|---|---|
| pb-db | ~450 MB（shared_buffers 512MB） |
| pb-web | ~200 MB |
| pb-worker（并发 3） | ~350 MB（含 ONNX 模型 ~120MB） |
| **合计** | **~1 GB / 16 GB** |

---

## 13. 风险登记册

| # | 风险 | 影响 | 应对 |
|---|---|---|---|
| 13.1 | 微信风控/封号 | 高 | **只抓公开 URL，绝不注入 Cookie 批量爬**。单篇手动保存风险极低。批量抓取功能不做，文档里写明 |
| 13.2 | 公众号图片过期/被清 | 高 | 采集即落盘（压缩图）；`snapshot` 保留 |
| 13.3 | 微信改版导致 adapter 失效 | 中 | 选择器集中在一处 + 失败降级到 generic + fixture 回归测试 |
| 13.4 | 小红书 `xsec_token` 过期 | 中 | 保存瞬间快照，不指望以后重抓；UI 标 `full=false` |
| 13.5 | 抖音视频体积爆炸 | 中 | 默认只存元信息，视频下载是显式开关 |
| 13.6 | 自己数据锁死 | 高 | 第一天就有 Markdown 导出 + `./data` 整目录备份 |
| 13.7 | 单人项目烂尾 | 高 | M0 第一周就要能日常用；每个 Sprint 有可交付物 |
| 13.8 | 版权/合规（开源后） | 中 | 仓库只放合成的测试 HTML，不提交真实正文；README 写明"仅用于个人归档" |
| 13.9 | N100 内存吃紧 | 低 | 已按 1GB 预算设计；Chromium 是可选 profile |
| 13.10 | 绿联固件升级破坏容器 | 低 | 数据全在 bind mount，`docker compose up -d` 可重建 |
| **12.11** | **「预览原图」长期失效** | **中** | 原图不落盘，源站删文/限流后就永久拿不到。已明确降级文案，不算 bug。缓解：`display` 参数调到 2000/q85，让压缩图本身足够清晰 |
| **12.12** | **`origin_url` 采集时缺失** | **中** | 缺失即永久失去该图的「预览原图」能力。缓解：适配器强制校验，取不到源地址时置 `sourceAvailable=false` 并在采集日志 warn；扩展上传的 blob 场景要显式说明 |
| **12.13** | **`/source` 端点被当代理滥用 / SSRF** | **中** | 仅认证用户可调；协议白名单 + 私有网段拒绝 + 32MB 上限 + 15s 超时 + 单 asset 每分钟限流 |
| 13.14 | 临时目录残留撑爆盘 | 低 | 派生用 `try/finally` 删除；容器启动清 `/tmp/pb-upload` |
| **13.15** | **服务端抓公众号被验证码拦** | **高（已实证）** | 非住宅 IP 上命中 `wappoc_appmsgcaptcha`（2026-11-24 实测）。缓解：① `detectBlock()` 明确识别，提示用户走浏览器路径；② 扩展 / 粘贴正文通道是必需而非可选；③ NAS 的家用 IP 可能可用，需实测 |

---

## 14. 后续路线（M1–M3）

### M1｜顺手（M0 之后 ~2 周）

- 小红书 adapter 完整化（扩展读 `__INITIAL_STATE__`）
- 抖音元信息 + 可选视频下载
- 高亮导出（Markdown / Readwise 格式）
- Cubox / Karakeep / Pocket 导入器
- 全文 + 语义混合检索
- 阅读主题精细调校；字体自定义上传

### M2｜聪明

- L2 向量近邻标签传播 + L3 LLM 全量接入
- 智能集合（保存查询）
- 自动摘要与"为什么值得读"
- 相关推荐（同集合内相似条目）
- 统计面板（来源分布、阅读趋势）

### M3｜生态

- 多用户 + 权限
- 飞书 / Telegram Bot（长连接，手机转发即存，**体验天花板**）
- 原生 iOS App：Share Extension + WKWebView 带登录态抓取（**手机上彻底解决微信**）
- S3 / WebDAV 存储后端
- 公众号 RSS 订阅（独立项目）
- Adapter 插件目录

---

## 15. 开放问题

### 已决策（2026-11-23 用户拍板）

| # | 问题 | 决定 | 落地位置 |
|---|---|---|---|
| **Q3** | 图片是否保留原图 | **✅ 不保留。存储一律以压缩图为准；原图仅在 lightbox 里按下「预览原图」时按需回源** | ADR-013、§5.4、§8.2、§12.1 |
| **Q6** | 阅读页是否提供"原文链接" | **✅ 提供，且在新页面打开**（`target="_blank" rel="noopener noreferrer"`） | §8.1 阅读页头部 |
| Q5 | 单集合 vs 多集合 | ✅ 坚持单归属（ADR-011），标签补足 | §4.2 |

### 待定

| # | 问题 | 当前倾向 | 需要决定的时间 |
|---|---|---|---|
| Q1 | 项目正式名 | 暂用 `个人bookmark`，`@pb/*` scope | M0 结束前 |
| Q2 | 是否要做公众号"阅读历史"提示（这篇文章你 3 个月前读过了） | 倾向 M1 做 | M1 |
| Q4 | 是否支持 PDF/EPUB | 倾向 M1 支持 PDF（公众号常带 PDF 附件） | M1 |
| Q7 | 回源失败后是否做定期重试（如 7 天后试一次） | 倾向不做，失败即标 `gone` 永不重试，省得无谓请求 | M0 后按实际使用再定 |
| Q8 | `display` 的长边/质量是否还要再调（当前 2000/q85） | 先用这档，用一个月看文字截图够不够清楚 | M0 后 |

---

## 附录 A：内置默认数据

**默认集合**

```
公众号/
小红书/
抖音/
待读/
参考资料/
```

**默认规则**（见 §7.2）

**默认标签**（不预置，避免污染用户体系；仅 `微信`/`小红书`/`抖音` 三个来源标签由规则自动加）

---

## 附录 B：变更记录

| 版本 | 日期 | 变更 |
|---|---|---|
| v0.1 | 2026-11-23 | 初稿：产品定义、12 条 ADR、数据模型、API 契约、Adapter 规范、M0 拆分 |
| v0.2 | 2026-11-23 | ~~Q3 定案：原图保留 + 三档变体~~ **已被 v0.3 推翻**；Q6 定案：原文链接置于阅读页头部、新窗口打开 |
| v0.3 | 2026-11-23 | **Q3 重新定案（推翻 v0.2 的误读）**：所有存储以压缩图为准，**原图不落盘**；`asset_variant` 枚举收窄为 `thumb`/`display`；新 `GET /assets/:id/source` 按需回源端点（含 SSRF 防护、LRU、失败降级）；`origin_url` 升级为功能字段并新增 `source_available`/`source_status` 等状态列；`display` 参数上调至 2000/q85（因成为唯一副本）；存储预算 22GB → 11GB；新增风险 13.11–13.14 |
| v0.4 | 2026-11-23 | **新增 §9 界面与交互**：参考 Cubox（结构/气质）+ Karakeep（密度/暗色），含响应式三档断点、侧栏信息架构、列表三密度、阅读页骨架、Design Tokens、移动端特化、空/错状态；原 §9–§14 顺延为 §10–§15，风险表行号 12.x→13.x；Sprint 0 增设计令牌任务、Sprint 3/4 增 UI 任务 |
| v0.5 | 2026-11-23 | **Sprint 0 已实现**（11 张表迁移、认证、三栏骨架、设置页/令牌管理、worker 骨架、compose）。据实测修正 §6.4 两条 URL 规则：末尾斜杠一律去除；小红书丢弃全部 `xsec_*`。实现层面的偏差记录在 README「与 SPEC 的差异」 |
| v0.6 | 2026-11-24 | **修复首启密码不可见**：原来密码只在"有人尝试登录"时生成，而用户正因为没密码才登不进来（真机部署时踩到）。改为登录页渲染时即生成并打日志；新增 `ADMIN_PASSWORD` 环境变量可直指定。`instrumentation.ts` 方案因 Edge 构建不兼容被否决，理由记入 §10.4 |
| v0.7 | 2026-11-24 | **Sprint 1 主体完成**：fetcher（含 `detectBlock` 验证码识别）、wechat/generic adapter、sanitize、图片两档变体管线、capture 任务、`/api/v1/capture`、assets display/thumb/source 三个端点（含 SSRF 防护与 LRU）、阅读页与 lightbox、粘贴框。`item` 新增 `fetch_state`/`fetch_error`/`fetched_at`（0001 迁移）。`asset.sha256` 由全局唯一改为「条目内唯一」（0002 迁移），避免跨条目删除耦合 |
