import { cache } from 'react';
import { eq, sql } from 'drizzle-orm';
import { collection, getDb, item, tag } from '@pb/db';

export type SidebarCounts = {
  inbox: number;
  reading: number;
  all: number;
  archived: number;
};

export type CollectionNode = {
  id: string;
  name: string;
  parentId: string | null;
  count: number;
};

export type SidebarData = {
  counts: SidebarCounts;
  collections: CollectionNode[];
  tags: string[];
};

const EMPTY: SidebarData = {
  counts: { inbox: 0, reading: 0, all: 0, archived: 0 },
  collections: [],
  tags: [],
};

/**
 * 侧栏数据：计数 + 集合树 + 标签。
 * 数据库不可用时返回 null，由 UI 显示降级提示（首启排障友好）。
 */
export async function loadSidebarData(): Promise<SidebarData | null> {
  try {
    const db = getDb();

    const statusRows = await db
      .select({
        status: item.status,
        n: sql<number>`count(*)::int`,
      })
      .from(item)
      .groupBy(item.status);

    const counts: SidebarCounts = { inbox: 0, reading: 0, all: 0, archived: 0 };
    for (const row of statusRows) {
      const n = Number(row.n);
      counts[row.status] = n;
      counts.all += n;
    }

    const collections = await db
      .select({
        id: collection.id,
        name: collection.name,
        parentId: collection.parentId,
        sort: collection.sort,
      })
      .from(collection)
      .orderBy(collection.sort, collection.name);

    const perCollection = await db
      .select({
        collectionId: item.collectionId,
        n: sql<number>`count(*)::int`,
      })
      .from(item)
      .groupBy(item.collectionId);

    const countMap = new Map<string, number>();
    for (const row of perCollection) {
      if (row.collectionId) countMap.set(row.collectionId, Number(row.n));
    }

    const tagRows = await db
      .select({ name: tag.name })
      .from(tag)
      .orderBy(tag.name)
      .limit(24);

    return {
      counts,
      collections: collections.map((c) => ({
        id: c.id,
        name: c.name,
        parentId: c.parentId,
        count: countMap.get(c.id) ?? 0,
      })),
      tags: tagRows.map((t) => t.name),
    };
  } catch (err) {
    console.error('[pb] 侧栏数据加载失败（数据库可能未就绪）', err);
    return null;
  }
}

export async function countItemsByStatus(status: 'inbox' | 'reading' | 'archived'): Promise<number> {
  const db = getDb();
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(item)
    .where(eq(item.status, status));
  return Number(rows[0]?.n ?? 0);
}

/**
 * React cache：同一请求内 layout 与 page 各调一次时只查一次库。
 */
export const getSidebarData = cache(loadSidebarData);

export { EMPTY as EMPTY_SIDEBAR };
