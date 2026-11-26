import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import type { ItemDetail } from '@pb/contract';
import { getDb, item } from '@pb/db';
import { authenticate } from '@/lib/session';
import { ApiError, jsonError } from '@/lib/api';
import { deleteItemDeep } from '@/lib/itemDelete';

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

/** 允许改：状态（归档/待读）、标题、所属集合 */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const auth = await authenticate(req);
    if (!auth) throw new ApiError(401, 'UNAUTHORIZED', '未登录');
    if (!auth.scopes.includes('write')) throw new ApiError(403, 'FORBIDDEN', '该令牌无写入权限');

    const { id } = await ctx.params;
    if (!UUID_RE.test(id)) throw new ApiError(400, 'BAD_REQUEST', 'id 不是合法 UUID');

    const raw = (await req.json().catch(() => ({}))) as {
      status?: string;
      title?: string;
      /** null = 移出集合 */
      collectionId?: string | null;
    };

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (raw.status === 'inbox' || raw.status === 'reading' || raw.status === 'archived') {
      patch.status = raw.status;
      patch.readAt = raw.status === 'archived' ? new Date() : null;
    }
    if (typeof raw.title === 'string' && raw.title.trim().length > 0) {
      patch.title = raw.title.trim().slice(0, 500);
    }
    // 显式区分"没传"和"传了 null"：后者表示移出集合
    if (raw.collectionId === null) {
      patch.collectionId = null;
    } else if (typeof raw.collectionId === 'string' && UUID_RE.test(raw.collectionId)) {
      patch.collectionId = raw.collectionId;
    }

    const db = getDb();
    const updated = await db
      .update(item)
      .set(patch)
      .where(eq(item.id, id))
      .returning({ id: item.id, status: item.status, title: item.title, collectionId: item.collectionId });

    if (!updated[0]) throw new ApiError(404, 'NOT_FOUND', '条目不存在');

    return NextResponse.json(updated[0]);
  } catch (err) {
    return jsonError(err);
  }
}

/**
 * 删除条目（不可恢复）
 *
 * 会连带删掉：资产行、变体行、标签关联、快照、高亮，以及**磁盘上的图片文件**。
 * 文件删除失败不阻断删除（返回里带 filesFailed），否则用户会看到
 * "删不掉"却没法处理；孤儿文件留给后续清理任务扫。
 */
export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const auth = await authenticate(req);
    if (!auth) throw new ApiError(401, 'UNAUTHORIZED', '未登录');
    if (!auth.scopes.includes('write')) throw new ApiError(403, 'FORBIDDEN', '该令牌无写入权限');

    const { id } = await ctx.params;
    if (!UUID_RE.test(id)) throw new ApiError(400, 'BAD_REQUEST', 'id 不是合法 UUID');

    const result = await deleteItemDeep(id);
    if (!result.ok) throw new ApiError(404, 'NOT_FOUND', '条目不存在');

    return NextResponse.json(result);
  } catch (err) {
    return jsonError(err);
  }
}
