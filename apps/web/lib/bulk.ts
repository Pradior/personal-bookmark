/**
 * 批量操作：回收站 / 恢复 / 彻底删除 / 改状态
 *
 * 为什么用**一条批量接口**而不是前端循环发 N 个请求：
 * 选中 50 条时 50 个请求既慢又容易半途失败（部分成功、部分失败），
 * 用户看到的列表会和实际不一致。这里用一条 UPDATE ... WHERE id = ANY(...)，
 * 要么全成、要么全不成。
 */
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { asset, assetVariant, getDb, item } from '@pb/db';
import { deleteAssetFiles } from './storage';

export type BulkAction =
  | 'trash'
  | 'restore'
  | 'purge'
  | 'archive'
  | 'inbox'
  | 'reading'
  | 'collection';

export type BulkResult = {
  affected: number;
  filesDeleted: number;
  filesFailed: number;
};

const BATCH_LIMIT = 500;

function guardIds(ids: string[]): string[] {
  const unique = [...new Set(ids)].slice(0, BATCH_LIMIT);
  if (unique.length === 0) throw new Error('没有选中任何条目');
  return unique;
}

/** 送到回收站（软删除）：保留数据与图片，只是从列表消失 */
export async function trashItems(ids: string[]): Promise<BulkResult> {
  const db = getDb();
  const safe = guardIds(ids);
  const rows = await db
    .update(item)
    .set({ status: 'trashed', trashedAt: new Date(), updatedAt: new Date() })
    .where(inArray(item.id, safe))
    .returning({ id: item.id });
  return { affected: rows.length, filesDeleted: 0, filesFailed: 0 };
}

/** 从回收站恢复：回到收件箱，并清掉 trashedAt */
export async function restoreItems(ids: string[]): Promise<BulkResult> {
  const db = getDb();
  const safe = guardIds(ids);
  const rows = await db
    .update(item)
    .set({ status: 'inbox', trashedAt: null, updatedAt: new Date() })
    .where(inArray(item.id, safe))
    .returning({ id: item.id });
  return { affected: rows.length, filesDeleted: 0, filesFailed: 0 };
}

/**
 * 彻底删除：行 + 磁盘文件。
 *
 * 只允许删**已经在回收站里的**条目 —— 否则误调用批量接口会把正常条目
 * 直接抹掉，连后悔的机会都没有。
 */
export async function purgeItems(ids: string[]): Promise<BulkResult> {
  const db = getDb();
  const safe = guardIds(ids);

  const targets = await db
    .select({ id: item.id })
    .from(item)
    .where(and(inArray(item.id, safe), eq(item.status, 'trashed')));

  const targetIds = targets.map((t) => t.id);
  if (targetIds.length === 0) return { affected: 0, filesDeleted: 0, filesFailed: 0 };

  // 先拿文件路径，删行之后就查不到了
  const assets = await db
    .select({ id: asset.id })
    .from(asset)
    .where(inArray(asset.itemId, targetIds));

  const variants = assets.length
    ? await db
        .select({ storageKey: assetVariant.storageKey })
        .from(assetVariant)
        .where(
          inArray(
            assetVariant.assetId,
            assets.map((a) => a.id),
          ),
        )
    : [];

  const removed = await db
    .delete(item)
    .where(inArray(item.id, targetIds))
    .returning({ id: item.id });

  const files = await deleteAssetFiles(variants.map((v) => v.storageKey));
  return { affected: removed.length, filesDeleted: files.deleted, filesFailed: files.failed };
}

/** 批量改状态 / 改集合 */
export async function bulkUpdate(
  ids: string[],
  patch: { status?: 'inbox' | 'reading' | 'archived'; collectionId?: string | null },
): Promise<BulkResult> {
  const db = getDb();
  const safe = guardIds(ids);

  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.status) {
    set.status = patch.status;
    set.readAt = patch.status === 'archived' ? new Date() : null;
    // 从回收站被改动状态时，顺带清掉 trashedAt，不然它还会出现在回收站
    set.trashedAt = null;
  }
  if (patch.collectionId !== undefined) set.collectionId = patch.collectionId;

  const rows = await db
    .update(item)
    .set(set)
    .where(inArray(item.id, safe))
    .returning({ id: item.id });

  return { affected: rows.length, filesDeleted: 0, filesFailed: 0 };
}

/** 回收站里还有多少条（侧栏计数用） */
export async function countTrashed(): Promise<number> {
  const db = getDb();
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(item)
    .where(and(eq(item.status, 'trashed'), isNotNull(item.trashedAt)));
  return Number(rows[0]?.n ?? 0);
}
