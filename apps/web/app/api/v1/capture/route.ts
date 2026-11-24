import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { CaptureRequest, type CaptureResponse } from '@pb/contract';
import { canonicalizeUrl, extractFirstUrl, parseUrl } from '@pb/core';
import { getDb, item } from '@pb/db';
import { authenticate } from '@/lib/session';
import { ApiError, jsonError, parseBody } from '@/lib/api';
import { clientKey, rateLimit } from '@/lib/ratelimit';
import { enqueueCapture } from '@/lib/queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 保存一条（SPEC §5.3）
 *
 * 关键语义：**先入库，再异步抓**。
 * 这样即使抓取失败，链接和你写的东西也留住了（SPEC §6.2 的底线），
 * 用户还能在列表里看到"仅保存了链接"并重试。
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const auth = await authenticate(req);
    if (!auth) throw new ApiError(401, 'UNAUTHORIZED', '未登录');
    if (!auth.scopes.includes('capture')) {
      throw new ApiError(403, 'FORBIDDEN', '该令牌没有 capture 权限');
    }

    // 采集是重活，限制频率
    if (!rateLimit(clientKey(req, 'capture'), 30, 60_000)) {
      throw new ApiError(429, 'RATE_LIMITED', '保存太频繁，稍等一下');
    }

    const body = await parseBody(req, CaptureRequest);

    // 允许用户直接粘贴"标题 + 链接"的整段分享文案
    const rawUrl = extractFirstUrl(body.url) ?? body.url;
    const parsed = parseUrl(rawUrl);
    if (!parsed) throw new ApiError(400, 'BAD_REQUEST', '认不出这是个链接');

    const canonical = canonicalizeUrl(rawUrl);
    if (!canonical) throw new ApiError(400, 'BAD_REQUEST', '链接无法规范化');

    const db = getDb();

    // 精确去重：同一条链接不重复入库
    const dup = await db
      .select({ id: item.id })
      .from(item)
      .where(eq(item.canonicalUrl, canonical.canonicalUrl))
      .limit(1);

    if (dup[0]) {
      const payload: CaptureResponse = {
        itemId: dup[0].id,
        jobId: null,
        status: 'duplicate',
        duplicate: true,
        existingItemId: dup[0].id,
      };
      return NextResponse.json(payload, { status: 409 });
    }

    // 有客户端 HTML 就不用等回源；否则 worker 去抓
    const hasClientHtml = typeof body.html === 'string' && body.html.length > 200;

    const [inserted] = await db
      .insert(item)
      .values({
        type: 'article',
        source: canonical.source,
        status: 'inbox',
        url: canonical.url,
        canonicalUrl: canonical.canonicalUrl,
        title: body.hint?.title ?? null,
        author: body.hint?.author ?? null,
        excerpt: body.hint?.excerpt ?? null,
        collectionId: body.collectionId ?? null,
        fetchState: 'queued',
        fetchedAt: null,
        meta: hasClientHtml
          ? { clientHtml: body.html, client: body.client }
          : { client: body.client },
      })
      .returning({ id: item.id });

    if (!inserted) throw new ApiError(500, 'INTERNAL', '写入条目失败');

    let jobId: string | null = null;
    try {
      jobId = await enqueueCapture(inserted.id);
    } catch (err) {
      // 入队失败不该让用户白丢一次保存：条目已经在库里了，
      // 标成 failed 让他能重试
      console.error('[capture] 入队失败', err);
      await db
        .update(item)
        .set({ fetchState: 'failed', fetchError: '任务入队失败，可点重试' })
        .where(eq(item.id, inserted.id));
      throw new ApiError(503, 'DB_UNAVAILABLE', '任务队列暂时不可用，条目已保存，稍后可重试');
    }

    const payload: CaptureResponse = {
      itemId: inserted.id,
      jobId,
      status: 'queued',
      duplicate: false,
    };
    return NextResponse.json(payload, { status: 202 });
  } catch (err) {
    return jsonError(err);
  }
}
