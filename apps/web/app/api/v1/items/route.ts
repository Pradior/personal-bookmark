import { NextResponse, type NextRequest } from 'next/server';
import { and, desc, asc, eq, gte, lte, lt, or, sql, type SQL } from 'drizzle-orm';
import { ItemListQuery, type ItemSummary, type Page } from '@pb/contract';
import { getDb, item } from '@pb/db';
import { authenticate } from '@/lib/session';
import { ApiError, jsonError, parseQuery } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/* ── cursor：keyset 分页（SPEC §5.6），不用 offset ─── */

function encodeCursor(when: Date, id: string): string {
  return Buffer.from(`${when.toISOString()}|${id}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): { when: Date; id: string } | null {
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const idx = raw.lastIndexOf('|');
    if (idx <= 0) return null;
    const when = new Date(raw.slice(0, idx));
    const id = raw.slice(idx + 1);
    if (Number.isNaN(when.getTime()) || !id) return null;
    return { when, id };
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const auth = await authenticate(req);
    if (!auth) throw new ApiError(401, 'UNAUTHORIZED', '未登录');

    const q = parseQuery(req, ItemListQuery);

    // 排序生效列：published_desc 用 coalesce，避免大量 NULL 沉底。
    // 统一包成 SQL，否则联合类型会让 eq/lt 的重载解析失败。
    const effectiveTime =
      q.sort === 'published_desc'
        ? sql`coalesce(${item.publishedAt}, ${item.savedAt})`
        : sql`${item.savedAt}`;
    const descending = q.sort !== 'saved_asc';

    const conditions: SQL[] = [];
    if (q.status !== 'all') conditions.push(eq(item.status, q.status));
    if (q.collection) conditions.push(eq(item.collectionId, q.collection));
    if (q.source) conditions.push(eq(item.source, q.source));
    if (q.type) conditions.push(eq(item.type, q.type));
    if (q.from) conditions.push(gte(item.savedAt, q.from));
    if (q.to) conditions.push(lte(item.savedAt, q.to));
    // TODO(Sprint 3): q.q 走 tsvector FTS + pg_trgm

    if (q.cursor) {
      const decoded = decodeCursor(q.cursor);
      if (!decoded) throw new ApiError(400, 'BAD_REQUEST', 'cursor 无效');
      const comparison = descending
        ? or(
            lt(effectiveTime, decoded.when),
            and(eq(effectiveTime, decoded.when), lt(item.id, decoded.id)),
          )
        : or(
            sql`${effectiveTime} > ${decoded.when}`,
            and(eq(effectiveTime, decoded.when), sql`${item.id} > ${decoded.id}`),
          );
      if (comparison) conditions.push(comparison);
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const db = getDb();
    const rows = await db
      .select({
        id: item.id,
        type: item.type,
        source: item.source,
        status: item.status,
        url: item.url,
        title: item.title,
        author: item.author,
        siteName: item.siteName,
        excerpt: item.excerpt,
        savedAt: item.savedAt,
        publishedAt: item.publishedAt,
        readAt: item.readAt,
        wordCount: item.wordCount,
        collectionId: item.collectionId,
        coverAssetId: item.coverAssetId,
        fetchState: item.fetchState,
        fetchError: item.fetchError,
      })
      .from(item)
      .where(where)
      .orderBy(
        descending ? desc(effectiveTime) : asc(effectiveTime),
        descending ? desc(item.id) : asc(item.id),
      )
      .limit(q.limit + 1);

    const hasMore = rows.length > q.limit;
    const page = hasMore ? rows.slice(0, q.limit) : rows;
    const last = page[page.length - 1];

    const items: ItemSummary[] = page.map((r) => ({
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
      // TODO(Sprint 3): 与 item_tag 联表
      tags: [],
      fetchState: r.fetchState,
      fetchError: r.fetchError,
    }));

    const body: Page<ItemSummary> = {
      items,
      nextCursor:
        hasMore && last
          ? encodeCursor(
              q.sort === 'published_desc'
                ? (last.publishedAt ?? last.savedAt)
                : last.savedAt,
              last.id,
            )
          : null,
    };

    return NextResponse.json(body);
  } catch (err) {
    return jsonError(err);
  }
}
