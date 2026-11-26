/**
 * 数据模型 —— 与 SPEC.md §4 对应。
 *
 * 关键约束（改动前请读 SPEC）：
 * - asset_variant 只允许 thumb / display（ADR-013：原图不落盘）
 * - asset.origin_url 是「预览原图」的唯一取数来源，采集时必须写入
 * - item.search_text 存 jieba 预分词结果，供 to_tsvector('simple', ...) 使用（ADR-005）
 */
import { sql } from 'drizzle-orm';
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  varchar,
  integer,
  bigint,
  real,
  timestamp,
  jsonb,
  boolean,
  index,
  uniqueIndex,
  customType,
} from 'drizzle-orm/pg-core';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

/** pgvector 原生类型（需要 001_extensions.sql 先建扩展） */
const vector512 = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return 'vector(512)';
  },
  toDriver(value: number[]) {
    return JSON.stringify(value);
  },
  fromDriver(value: unknown) {
    return JSON.parse(String(value)) as number[];
  },
});

/* ── 枚举 ─────────────────────────────────────────── */

export const itemTypeEnum = pgEnum('item_type', [
  'article',
  'note',
  'image',
  'video',
  'link',
]);

export const itemSourceEnum = pgEnum('item_source', [
  'wechat',
  'xhs',
  'douyin',
  'web',
  'manual',
]);

export const itemStatusEnum = pgEnum('item_status', ['inbox', 'reading', 'archived']);

export const tagSourceEnum = pgEnum('tag_source', ['manual', 'rule', 'propagated', 'llm']);

/**
 * 抓取状态机（SPEC §9.9 的"处理中卡片"靠它驱动）
 *   queued   → 已入库，等 worker 处理
 *   fetching → 正在抓 HTML / 解析
 *   assets   → 正在下载并转码图片
 *   done     → 完成
 *   failed   → 失败（fetch_error 里写原因），条目仍然保留
 */
export const itemFetchStateEnum = pgEnum('item_fetch_state', [
  'queued',
  'fetching',
  'assets',
  'done',
  'failed',
]);


export const assetKindEnum = pgEnum('asset_kind', [
  'image',
  'thumbnail',
  'pdf',
  'video',
  'audio',
  'cover',
]);

/** 只有两档：原图不落盘（ADR-013） */
export const assetVariantKindEnum = pgEnum('asset_variant_kind', ['thumb', 'display']);

/* ── 集合：树形，单归属（ADR-011） ────────────────── */

export const collection = pgTable(
  'collection',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    parentId: uuid('parent_id').references((): AnyPgColumn => collection.id, {
      onDelete: 'cascade',
    }),
    name: varchar('name', { length: 120 }).notNull(),
    sort: integer('sort').notNull().default(0),
    /** false = 该集合下的内容不送云端 LLM（ADR-010 隐私开关） */
    aiEnabled: boolean('ai_enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('collection_parent_idx').on(t.parentId, t.sort)],
);

/* ── 条目主体 ─────────────────────────────────────── */

export const item = pgTable(
  'item',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: itemTypeEnum('type').notNull().default('article'),
    source: itemSourceEnum('source').notNull().default('web'),
    status: itemStatusEnum('status').notNull().default('inbox'),

    /**
     * 原始链接，用于「原文 ↗」，不去参数。
     * 可为空：速记（文字/图片）没有来源链接。
     */
    url: text('url'),
    /**
     * 规范化链接，用于精确去重（SPEC §6.4）。
     * 可为空；唯一索引是**部分索引**（WHERE canonical_url IS NOT NULL），
     * 否则多条速记的 NULL 会互相冲突。
     */
    canonicalUrl: text('canonical_url'),

    title: text('title'),
    author: text('author'),
    siteName: text('site_name'),
    excerpt: text('excerpt'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    savedAt: timestamp('saved_at', { withTimezone: true }).notNull().defaultNow(),
    readAt: timestamp('read_at', { withTimezone: true }),

    /** 清洗后、图片已改写为 /api/v1/assets/:id */
    contentHtml: text('content_html'),
    contentText: text('content_text'),
    wordCount: integer('word_count').notNull().default(0),
    lang: varchar('lang', { length: 16 }).default('zh'),

    /**
     * 封面资源。刻意不加外键：item → asset（cover）与 asset → item（item_id）
     * 互相引用会成环；asset 的生命周期已由 asset.item_id 的 cascade 管住，
     * 这里按软引用处理，引用完整性由应用层保证。删除资源时记得置空。
     */
    coverAssetId: uuid('cover_asset_id'),
    collectionId: uuid('collection_id').references(() => collection.id, {
      onDelete: 'set null',
    }),

    /** jieba 预分词，空格连接（ADR-005） */
    searchText: text('search_text').notNull().default(''),
    /** 内容指纹，近似去重 */
    simhash: bigint('simhash', { mode: 'bigint' }),
    /** bge-small-zh-v1.5，512 维（ADR-010） */
    embedding: vector512('embedding'),

    adapterId: varchar('adapter_id', { length: 32 }),
    meta: jsonb('meta').$type<Record<string, unknown>>().default({}),

    /** 抓取状态；手动速记直接是 done，抓取类条目从 queued 开始 */
    fetchState: itemFetchStateEnum('fetch_state').notNull().default('done'),
    /** 失败原因，直接展示给用户（例如"触发人机验证"） */
    fetchError: text('fetch_error'),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('item_canonical_url_idx')
      .on(t.canonicalUrl)
      .where(sql`"canonical_url" IS NOT NULL`),
    index('item_status_saved_idx').on(t.status, t.savedAt),
    index('item_collection_idx').on(t.collectionId, t.savedAt),
    index('item_source_idx').on(t.source),
    index('item_simhash_idx').on(t.simhash),
    index('item_url_idx').on(t.url),
  ],
);

/* ── 资源：只存压缩图，原图按需回源（ADR-013） ────── */

export const asset = pgTable(
  'asset',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    itemId: uuid('item_id').references(() => item.id, { onDelete: 'cascade' }),
    kind: assetKindEnum('kind').notNull().default('image'),

    /** 源文件字节的哈希：下载瞬间算出，用于去重与缓存键；文件本身不留 */
    sha256: varchar('sha256', { length: 64 }).notNull(),
    sourceMime: varchar('source_mime', { length: 64 }),
    sourceWidth: integer('source_width'),
    sourceHeight: integer('source_height'),
    sourceBytes: integer('source_bytes'),

    /** 实际落盘的格式（通常 webp；动图例外为 image/gif） */
    mime: varchar('mime', { length: 64 }).notNull(),
    width: integer('width'),
    height: integer('height'),
    bytes: integer('bytes').notNull().default(0),
    /** GIF / APNG 不转码 */
    animated: boolean('animated').notNull().default(false),

    /** 「预览原图」的唯一取数来源 */
    originUrl: text('origin_url'),
    originReferer: text('origin_referer'),
    originUserAgent: text('origin_user_agent'),

    sourceAvailable: boolean('source_available').notNull().default(true),
    /** unknown | ok | failed | gone */
    sourceStatus: varchar('source_status', { length: 16 }).notNull().default('unknown'),
    sourceCheckedAt: timestamp('source_checked_at', { withTimezone: true }),
    sourceFailCount: integer('source_fail_count').notNull().default(0),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // 去重范围是"同一个条目内"，不是全局。
    // 全局唯一会让同一张图只能属于一个条目，删除一篇会连带带走另一篇的图；
    // 跨条目重复的图很罕见，多存一份的代价远小于这种耦合。
    index('asset_sha256_idx').on(t.sha256),
    index('asset_item_idx').on(t.itemId),
    uniqueIndex('asset_item_sha_idx').on(t.itemId, t.sha256),
  ],
);

export const assetVariant = pgTable(
  'asset_variant',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => asset.id, { onDelete: 'cascade' }),
    variant: assetVariantKindEnum('variant').notNull(),

    /** 形如 ab/abcdef...-display.webp（sha256 前两位分桶） */
    storageKey: text('storage_key').notNull(),
    mime: varchar('mime', { length: 64 }).notNull(),
    bytes: integer('bytes').notNull().default(0),
    width: integer('width'),
    height: integer('height'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('asset_variant_pk').on(t.assetId, t.variant),
    index('asset_variant_kind_idx').on(t.variant),
  ],
);

/* ── 标签 ─────────────────────────────────────────── */

export const tag = pgTable(
  'tag',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 64 }).notNull(),
    color: varchar('color', { length: 16 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('tag_name_idx').on(t.name)],
);

export const itemTag = pgTable(
  'item_tag',
  {
    itemId: uuid('item_id')
      .notNull()
      .references(() => item.id, { onDelete: 'cascade' }),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => tag.id, { onDelete: 'cascade' }),
    source: tagSourceEnum('source').notNull().default('manual'),
    confidence: real('confidence').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('item_tag_pk').on(t.itemId, t.tagId),
    index('item_tag_tag_idx').on(t.tagId),
  ],
);

/* ── 高亮（四元组定位，SPEC §8.3） ────────────────── */

export const highlight = pgTable(
  'highlight',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => item.id, { onDelete: 'cascade' }),
    quote: text('quote').notNull(),
    prefix: text('prefix').notNull().default(''),
    suffix: text('suffix').notNull().default(''),
    offset: integer('offset').notNull().default(0),
    color: varchar('color', { length: 16 }).notNull().default('yellow'),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('highlight_item_idx').on(t.itemId)],
);

/* ── 原始快照（解析器升级后可重跑） ───────────────── */

export const snapshot = pgTable(
  'snapshot',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => item.id, { onDelete: 'cascade' }),
    /** base64(gzip(html))，大文本走 TOAST */
    rawGz: text('raw_gz').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
    bytes: integer('bytes').notNull().default(0),
  },
  (t) => [index('snapshot_item_idx').on(t.itemId)],
);

/* ── 智能集合 / 规则 / 令牌 ────────────────────────── */

export const smartView = pgTable('smart_view', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 120 }).notNull(),
  filter: jsonb('filter').notNull().$type<Record<string, unknown>>(),
  sort: integer('sort').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const rule = pgTable('rule', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 120 }).notNull(),
  enabled: boolean('enabled').notNull().default(true),
  match: jsonb('match').notNull().$type<Record<string, unknown>>(),
  action: jsonb('action').notNull().$type<Record<string, unknown>>(),
  priority: integer('priority').notNull().default(100),
  hitCount: integer('hit_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const accessToken = pgTable(
  'access_token',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 80 }).notNull(),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    /** 明文前缀，便于用户辨认是哪一把 */
    prefix: varchar('prefix', { length: 12 }).notNull(),
    scopes: text('scopes')
      .array()
      .notNull()
      .default(sql`'{capture,read}'::text[]`),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('access_token_hash_idx').on(t.tokenHash)],
);

/* ── 站点凭据：抓取时附带的 Cookie ──────────────────── *
 *
 * 存的是 Cookie 字符串（不是账号密码）。用途：某些站点未登录时
 * 只返回空壳页面（小红书尤甚），带上登录态才能拿到内容。
 *
 * 安全性：用 AUTH_SECRET 派生密钥做 AES-256-GCM 加密后入库，
 * 数据库被 dump 也不至于直接泄漏。但仍是敏感数据 —— 界面里只显示掩码。
 */
export const siteCredential = pgTable(
  'site_credential',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** 域名，形如 xiaohongshu.com；抓取时按 host 后缀匹配 */
    domain: varchar('domain', { length: 200 }).notNull(),
    /** AES-256-GCM 密文，格式 iv.tag.cipher（base64url） */
    cookieCipher: text('cookie_cipher').notNull(),
    /** 部分站点要求 Cookie 与 UA 配套，否则会话失效 */
    userAgent: text('user_agent'),
    referer: text('referer'),
    enabled: boolean('enabled').notNull().default(true),
    note: varchar('note', { length: 200 }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('site_credential_domain_idx').on(t.domain)],
);
