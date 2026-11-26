import { and, asc, desc, eq } from 'drizzle-orm';
import type { ItemSummary } from '@pb/contract';
import { getDb, item } from '@pb/db';
import { neighborFilter, tagExistsFilter } from './sqlFragments';
import { tagsOf } from './taxonomy';

export type ListOptions = {
  status?: 'inbox' | 'reading' | 'archived' | 'all';
  limit?: number;
  /** 只看某个集合下的条目 */
  collectionId?: string;
  /** 只看带某个标签的条目 */
  tagName?: string;
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

    const where = [];
    if (status !== 'all') where.push(eq(item.status, status));
    if (options.collectionId) where.push(eq(item.collectionId, options.collectionId));
    if (options.tagName) {
      where.push(tagExistsFilter(options.tagName));
    }

    const rows = await db
      .select()
      .from(item)
      .where(where.length > 0 ? and(...where) : undefined)
      .orderBy(desc(item.savedAt), desc(item.id))
      .limit(limit);

    // 标签一次查完再按条目分组，避免 N+1
    const tagMap = await tagsOf(rows.map((r) => r.id)).catch(() => new Map<string, string[]>());

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
      tags: tagMap.get(r.id) ?? [],
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
      .where(neighborFilter(me.savedAt, me.id, 'newer'))
      .orderBy(asc(item.savedAt), asc(item.id))
      .limit(1),
    db
      .select({ id: item.id, title: item.title })
      .from(item)
      .where(neighborFilter(me.savedAt, me.id, 'older'))
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
