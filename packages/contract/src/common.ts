import { z } from 'zod';

/* ── 统一错误响应（SPEC §5.5） ──────────────────────── */

export const ErrorCode = z.enum([
  'BAD_REQUEST',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'DUPLICATE_ITEM',
  'FETCH_FAILED',
  'DB_UNAVAILABLE',
  'RATE_LIMITED',
  'INTERNAL',
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ErrorResponse = z.object({
  error: z.object({
    code: ErrorCode,
    message: z.string(),
    /** 重复条目时带出来，前端可直接跳转 */
    existingItemId: z.string().uuid().optional(),
    traceId: z.string().optional(),
  }),
});
export type ErrorResponse = z.infer<typeof ErrorResponse>;

/* ── 分页（SPEC §5.6：cursor，不用 offset） ─────────── */

export const CursorQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type CursorQuery = z.infer<typeof CursorQuery>;

export type Page<T> = {
  items: T[];
  nextCursor: string | null;
};

/* ── 枚举镜像（与 packages/db/schema.ts 保持一致） ──── */

export const ItemType = z.enum(['article', 'note', 'image', 'video', 'link']);
export type ItemType = z.infer<typeof ItemType>;

export const ItemSource = z.enum(['wechat', 'xhs', 'douyin', 'web', 'manual']);
export type ItemSource = z.infer<typeof ItemSource>;

export const ItemStatus = z.enum(['inbox', 'reading', 'archived', 'trashed']);
export type ItemStatus = z.infer<typeof ItemStatus>;

export const TagSource = z.enum(['manual', 'rule', 'propagated', 'llm']);
export type TagSource = z.infer<typeof TagSource>;

export const AssetVariantKind = z.enum(['thumb', 'display']);
export type AssetVariantKind = z.infer<typeof AssetVariantKind>;
