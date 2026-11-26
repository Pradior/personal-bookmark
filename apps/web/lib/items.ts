import { asc, desc, eq, sql } from 'drizzle-orm';
import type { ItemSummary } from '@pb/contract';
import { getDb, item } from '@pb/db';

export type ListOptions = {
  status?: 'inbox' | 'reading' | 'archived' | 'all';
  limit?: number;
};

/**
 * 服务端列表查询（页面用）。
 * 数据库不可用时返回 null，页面据此显示降级提示而不是白屏。
 */
export async function listItems(options: ListOptions = {}): Promise<ItemSummary[] | null> {
  try {
    const db = getDb();
    const limit = options.limit ?? 50;
    const status = options.status ?? 'all';

    const rows = await db
      .select()
      .from(item)
      .where(status === 'all' ? undefined : eq(item.status, status))
      .orderBy(desc(item.savedAt), desc(item.id))
      .limit(limit);

    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      source: r.source,
      status: r.status,
      url: r.url,
      title: r.title,
      author: r.author,
      siteName: r.siteName,
      excerpt: r.excerpt,
      savedAt: r.savedAt.toISOString(),
      publishedAt: r.publishedAt ? r.publishedAt.toISOString() : null,
      readAt: r.readAt ? r.readAt.toISOString() : null,
      wordCount: r.wordCount,
      collectionId: r.collectionId,
      coverAssetId: r.coverAssetId,
      tags: [],
      fetchState: r.fetchState,
      fetchError: r.fetchError,
    }));
  } catch (err) {
    console.error('[pb] 列表加载失败', err);
    return null;
  }
}

export async function getItem(id: string) {
  const db = getDb();
  const rows = await db.select().from(item).where(eq(item.id, id)).limit(1);
  return rows[0] ?? null;
}

/**
 * 同一条目在列表里的前后邻居（用于阅读页的 J/K 翻页）。
 *
 * 列表顺序是 `savedAt DESC, id DESC`，所以：
 *   prev = 列表里更靠上（更新）的那条
 *   next = 列表里更靠下（更旧）的那条
 * 用 (savedAt, id) 元组比较而不是只比时间 —— 同一秒存两条时不会卡住不动。
 */
export async function getNeighbors(id: string): Promise<{
  prevId: string | null;
  nextId: string | null;
  prevTitle: string | null;
  nextTitle: string | null;
}> {
  const db = getDb();

  const current = await db
    .select({ savedAt: item.savedAt, id: item.id })
    .from(item)
    .where(eq(item.id, id))
    .limit(1);
  const me = current[0];
  if (!me) return { prevId: null, nextId: null, prevTitle: null, nextTitle: null };

  const [newer, older] = await Promise.all([
    db
      .select({ id: item.id, title: item.title })
      .from(item)
      .where(
        // 显式 cast：行构造器里的参数如果不带类型，Postgres 可能推断不出来
        sql`(${item.savedAt}, ${item.id}) > (${me.savedAt}::timestamptz, ${me.id}::uuid)`,
      )
      .orderBy(asc(item.savedAt), asc(item.id))
      .limit(1),
    db
      .select({ id: item.id, title: item.title })
      .from(item)
      .where(
        sql`(${item.savedAt}, ${item.id}) < (${me.savedAt}::timestamptz, ${me.id}::uuid)`,
      )
      .orderBy(desc(item.savedAt), desc(item.id))
      .limit(1),
  ]);

  return {
    prevId: newer[0]?.id ?? null,
    nextId: older[0]?.id ?? null,
    prevTitle: newer[0]?.title ?? null,
    nextTitle: older[0]?.title ?? null,
  };
}

/** 有在处理的条目时，列表页需要定时刷新 */
export function hasProcessing(list: ItemSummary[]): boolean {
  return list.some(
    (i) => i.fetchState === 'queued' || i.fetchState === 'fetching' || i.fetchState === 'assets',
  );
}
