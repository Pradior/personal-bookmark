import { desc, eq } from 'drizzle-orm';
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
