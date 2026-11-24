import { z } from 'zod';
import { ItemSource, ItemStatus, ItemType, CursorQuery } from './common';

/* ── 列表查询（SPEC §5.6） ─────────────────────────── */

export const ItemListQuery = CursorQuery.extend({
  status: z.union([ItemStatus, z.literal('all')]).default('all'),
  collection: z.string().uuid().optional(),
  tag: z.union([z.string(), z.array(z.string())]).optional(),
  source: ItemSource.optional(),
  type: ItemType.optional(),
  /** 全文关键词（Sprint 3 接 FTS；Sprint 0 仅保留字段） */
  q: z.string().max(200).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  sort: z.enum(['saved_desc', 'saved_asc', 'published_desc']).default('saved_desc'),
});
export type ItemListQuery = z.infer<typeof ItemListQuery>;

export const ItemFetchState = z.enum(['queued', 'fetching', 'assets', 'done', 'failed']);
export type ItemFetchState = z.infer<typeof ItemFetchState>;

/* ── 条目摘要（列表卡片用，不含正文） ──────────────── */

export const ItemSummary = z.object({
  id: z.string().uuid(),
  type: ItemType,
  source: ItemSource,
  status: ItemStatus,
  url: z.string(),
  title: z.string().nullable(),
  author: z.string().nullable(),
  siteName: z.string().nullable(),
  excerpt: z.string().nullable(),
  savedAt: z.string().datetime(),
  publishedAt: z.string().datetime().nullable(),
  readAt: z.string().datetime().nullable(),
  wordCount: z.number().int(),
  collectionId: z.string().uuid().nullable(),
  coverAssetId: z.string().uuid().nullable(),
  tags: z.array(z.string()),
  /** 抓取状态：列表要据此渲染"处理中"卡片或失败角标 */
  fetchState: ItemFetchState,
  fetchError: z.string().nullable(),
});
export type ItemSummary = z.infer<typeof ItemSummary>;

/* ── 条目详情（阅读页用） ─────────────────────────── */

export const ItemDetail = ItemSummary.extend({
  contentHtml: z.string().nullable(),
  contentText: z.string().nullable(),
  siteName: z.string().nullable(),
  adapterId: z.string().nullable(),
});
export type ItemDetail = z.infer<typeof ItemDetail>;

/* ── 统计（侧栏徽标） ─────────────────────────────── */

export const SidebarCounts = z.object({
  inbox: z.number().int(),
  reading: z.number().int(),
  all: z.number().int(),
  archived: z.number().int(),
});
export type SidebarCounts = z.infer<typeof SidebarCounts>;
