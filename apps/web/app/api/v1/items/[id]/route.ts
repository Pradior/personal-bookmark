import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import type { ItemDetail } from '@pb/contract';
import { getDb, item } from '@pb/db';
import { authenticate } from '@/lib/session';
import { ApiError, jsonError } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const auth = await authenticate(req);
    if (!auth) throw new ApiError(401, 'UNAUTHORIZED', '未登录');

    const { id } = await ctx.params;
    if (!UUID_RE.test(id)) throw new ApiError(400, 'BAD_REQUEST', 'id 不是合法 UUID');

    const db = getDb();
    const rows = await db.select().from(item).where(eq(item.id, id)).limit(1);
    const row = rows[0];
    if (!row) throw new ApiError(404, 'NOT_FOUND', '条目不存在');

    const body: ItemDetail = {
      id: row.id,
      type: row.type,
      source: row.source,
      status: row.status,
      url: row.url,
      title: row.title,
      author: row.author,
      siteName: row.siteName,
      excerpt: row.excerpt,
      savedAt: row.savedAt.toISOString(),
      publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
      readAt: row.readAt ? row.readAt.toISOString() : null,
      wordCount: row.wordCount,
      collectionId: row.collectionId,
      coverAssetId: row.coverAssetId,
      tags: [],
      fetchState: row.fetchState,
      fetchError: row.fetchError,
      contentHtml: row.contentHtml,
      contentText: row.contentText,
      adapterId: row.adapterId,
    };

    return NextResponse.json(body);
  } catch (err) {
    return jsonError(err);
  }
}

/** 目前只允许改状态（归档/待读），标题与集合留到 Sprint 3 */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const auth = await authenticate(req);
    if (!auth) throw new ApiError(401, 'UNAUTHORIZED', '未登录');

    const { id } = await ctx.params;
    if (!UUID_RE.test(id)) throw new ApiError(400, 'BAD_REQUEST', 'id 不是合法 UUID');

    const raw = (await req.json().catch(() => ({}))) as {
      status?: string;
      title?: string;
    };

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (raw.status === 'inbox' || raw.status === 'reading' || raw.status === 'archived') {
      patch.status = raw.status;
      patch.readAt = raw.status === 'archived' ? new Date() : null;
    }
    if (typeof raw.title === 'string' && raw.title.trim().length > 0) {
      patch.title = raw.title.trim().slice(0, 500);
    }

    const db = getDb();
    const updated = await db
      .update(item)
      .set(patch)
      .where(eq(item.id, id))
      .returning({ id: item.id, status: item.status, title: item.title });

    if (!updated[0]) throw new ApiError(404, 'NOT_FOUND', '条目不存在');

    return NextResponse.json(updated[0]);
  } catch (err) {
    return jsonError(err);
  }
}
