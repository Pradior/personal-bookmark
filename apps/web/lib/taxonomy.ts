/**
 * 标签与集合的数据操作
 *
 * 设计取舍：
 * - 集合是**一层树**（有 parentId），但个人使用场景下两级足够；
 *   UI 先只做一级 + 子级展示，创建时也只挂在根上。
 * - 标签用「按名字 upsert」而不是先建后挂：用户输入 "技术" 就应该直接
 *   生效，不该先被要求去某个页面创建标签。tag.name 上有唯一索引。
 * - 删除集合时置空条目的 collection_id（FK onDelete: set null），
 *   不连带删条目 —— 删文件夹不该删内容。
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { collection, getDb, item, itemTag, tag } from '@pb/db';

export type CollectionWithCount = {
  id: string;
  name: string;
  parentId: string | null;
  count: number;
};

export async function listCollections(): Promise<CollectionWithCount[]> {
  const db = getDb();

  const rows = await db
    .select({ id: collection.id, name: collection.name, parentId: collection.parentId })
    .from(collection)
    .orderBy(collection.sort, collection.name);

  const counts = await db
    .select({ collectionId: item.collectionId, n: sql<number>`count(*)::int` })
    .from(item)
    .groupBy(item.collectionId);

  const countMap = new Map<string, number>();
  for (const row of counts) {
    if (row.collectionId) countMap.set(row.collectionId, Number(row.n));
  }

  return rows.map((r) => ({ ...r, count: countMap.get(r.id) ?? 0 }));
}

export async function createCollection(name: string): Promise<{ id: string; name: string }> {
  const trimmed = name.trim().slice(0, 120);
  if (!trimmed) throw new Error('集合名不能为空');

  const db = getDb();

  // 同名直接复用，避免点两次"新建"出来两个一样的
  const existing = await db
    .select({ id: collection.id, name: collection.name })
    .from(collection)
    .where(eq(collection.name, trimmed))
    .limit(1);
  if (existing[0]) return existing[0];

  const [created] = await db
    .insert(collection)
    .values({ name: trimmed })
    .returning({ id: collection.id, name: collection.name });

  if (!created) throw new Error('创建失败');
  return created;
}

export async function renameCollection(id: string, name: string): Promise<boolean> {
  const trimmed = name.trim().slice(0, 120);
  if (!trimmed) return false;
  const db = getDb();
  const rows = await db
    .update(collection)
    .set({ name: trimmed })
    .where(eq(collection.id, id))
    .returning({ id: collection.id });
  return rows.length > 0;
}

export async function deleteCollection(id: string): Promise<boolean> {
  const db = getDb();
  const rows = await db.delete(collection).where(eq(collection.id, id)).returning({ id: collection.id });
  return rows.length > 0;
}

export type TagWithCount = { name: string; count: number };

export async function listTags(limit = 100): Promise<TagWithCount[]> {
  const db = getDb();
  const rows = await db
    .select({ name: tag.name, n: sql<number>`count(${itemTag.itemId})::int` })
    .from(tag)
    .leftJoin(itemTag, eq(itemTag.tagId, tag.id))
    .groupBy(tag.id, tag.name)
    .orderBy(tag.name)
    .limit(limit);

  return rows.map((r) => ({ name: r.name, count: Number(r.n) }));
}

/** 按名字 upsert 标签并挂到条目上（幂等：重复挂不会报错） */
export async function attachTag(itemId: string, rawName: string): Promise<string> {
  const name = rawName.trim().replace(/^#+/, '').slice(0, 64);
  if (!name) throw new Error('标签名不能为空');

  const db = getDb();

  const [tagRow] = await db
    .insert(tag)
    .values({ name })
    .onConflictDoUpdate({ target: tag.name, set: { name } })
    .returning({ id: tag.id, name: tag.name });

  if (!tagRow) throw new Error('标签创建失败');

  await db
    .insert(itemTag)
    .values({ itemId, tagId: tagRow.id, source: 'manual', confidence: 1 })
    .onConflictDoNothing({ target: [itemTag.itemId, itemTag.tagId] });

  return tagRow.name;
}

export async function detachTag(itemId: string, name: string): Promise<boolean> {
  const db = getDb();
  const tagRows = await db.select({ id: tag.id }).from(tag).where(eq(tag.name, name)).limit(1);
  const tagId = tagRows[0]?.id;
  if (!tagId) return false;

  await db.delete(itemTag).where(and(eq(itemTag.itemId, itemId), eq(itemTag.tagId, tagId)));

  // 标签没有任何条目引用后删掉，避免侧栏堆一堆空标签
  const stillUsed = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(itemTag)
    .where(eq(itemTag.tagId, tagId));
  if (Number(stillUsed[0]?.n ?? 0) === 0) {
    await db.delete(tag).where(eq(tag.id, tagId));
  }

  return true;
}

/** 某条目的标签名列表 */
export async function tagsOf(itemIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (itemIds.length === 0) return out;

  const db = getDb();
  const rows = await db
    .select({ itemId: itemTag.itemId, name: tag.name })
    .from(itemTag)
    .innerJoin(tag, eq(tag.id, itemTag.tagId))
    .where(inArray(itemTag.itemId, itemIds));

  for (const row of rows) {
    const list = out.get(row.itemId) ?? [];
    list.push(row.name);
    out.set(row.itemId, list);
  }
  return out;
}

export async function setItemCollection(
  itemId: string,
  collectionId: string | null,
): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .update(item)
    .set({ collectionId, updatedAt: new Date() })
    .where(eq(item.id, itemId))
    .returning({ id: item.id });
  return rows.length > 0;
}
