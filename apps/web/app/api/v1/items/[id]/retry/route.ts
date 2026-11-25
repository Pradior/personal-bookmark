import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb, item } from '@pb/db';
import { authenticate } from '@/lib/session';
import { ApiError, jsonError } from '@/lib/api';
import { enqueueCapture } from '@/lib/queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 重试抓取。
 *
 * 为什么必须有：条目一入库就占用了 canonical_url，重新粘同一个链接会被
 * 去重挡回去（409）。那条"空壳"记录如果没救，就永久坏在那里了。
 *
 * 重试前把正文相关字段清空 —— 否则上一次抽到的垃圾内容会残留，
 * 用户看到的仍是脏数据。
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const auth = await authenticate(req);
    if (!auth) throw new ApiError(401, 'UNAUTHORIZED', '未登录');
    if (!auth.scopes.includes('capture')) {
      throw new ApiError(403, 'FORBIDDEN', '该令牌没有 capture 权限');
    }

    const { id } = await ctx.params;
    if (!UUID_RE.test(id)) throw new ApiError(400, 'BAD_REQUEST', 'id 不是合法 UUID');

    const db = getDb();
    const updated = await db
      .update(item)
      .set({
        fetchState: 'queued',
        fetchError: null,
        // 清掉上一次可能抽到的垃圾内容
        title: null,
        author: null,
        excerpt: null,
        contentHtml: null,
        contentText: null,
        wordCount: 0,
        coverAssetId: null,
        fetchedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(item.id, id))
      .returning({ id: item.id });

    if (!updated[0]) throw new ApiError(404, 'NOT_FOUND', '条目不存在');

    const jobId = await enqueueCapture(id);
    return NextResponse.json({ ok: true, itemId: id, jobId });
  } catch (err) {
    return jsonError(err);
  }
}
