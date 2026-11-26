/**
 * 条目的破坏性操作：删除
 *
 * 顺序很重要：
 *   1. 先查变体的 storageKey（删了库就查不到了）
 *   2. 删行（asset_variant / asset 靠 FK cascade）
 *   3. 再删磁盘文件
 *
 * 反过来做的话，中间失败就会留下"库里没记录、磁盘有文件"的孤儿，
 * 谁也发现不了。宁可留几个孤儿文件（有清理任务可扫），也不要留孤儿行。
 */
import { eq, inArray } from 'drizzle-orm';
import { asset, assetVariant, getDb, item } from '@pb/db';
import { deleteAssetFiles } from './storage';

export type DeleteResult = {
  ok: boolean;
  filesDeleted: number;
  filesFailed: number;
};

export async function deleteItemDeep(itemId: string): Promise<DeleteResult> {
  const db = getDb();

  // 1) 先把要删的文件路径拿到
  const assets = await db.select({ id: asset.id }).from(asset).where(eq(asset.itemId, itemId));
  const assetIds = assets.map((a) => a.id);

  const variants = assetIds.length
    ? await db
        .select({ storageKey: assetVariant.storageKey })
        .from(assetVariant)
        .where(inArray(assetVariant.assetId, assetIds))
    : [];

  // 2) 删行：asset / asset_variant / item_tag / highlight / snapshot 都由外键 cascade
  const removed = await db
    .delete(item)
    .where(eq(item.id, itemId))
    .returning({ id: item.id });

  if (removed.length === 0) {
    return { ok: false, filesDeleted: 0, filesFailed: 0 };
  }

  // 3) 再删文件
  const files = await deleteAssetFiles(variants.map((v) => v.storageKey));

  return { ok: true, filesDeleted: files.deleted, filesFailed: files.failed };
}
