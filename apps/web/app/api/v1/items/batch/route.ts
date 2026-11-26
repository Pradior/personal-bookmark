import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { authenticate } from '@/lib/session';
import { ApiError, jsonError, parseBody } from '@/lib/api';
import { bulkUpdate, purgeItems, restoreItems, trashItems } from '@/lib/bulk';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  action: z.enum(['trash', 'restore', 'purge', 'archived', 'inbox', 'reading', 'collection']),
  ids: z.array(z.string().uuid()).min(1).max(500),
  /** action='collection' 时用；null = 移出集合 */
  collectionId: z.string().uuid().nullable().optional(),
});

/**
 * 批量操作（一次请求处理一整批选中项）
 *
 * 分开的 action 而不是一个通用 patch：不同动作的权限与校验差别很大
 * （purge 只允许对回收站里的条目），枚举出来更容易守住边界。
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const auth = await authenticate(req);
    if (!auth) throw new ApiError(401, 'UNAUTHORIZED', '未登录');
    if (!auth.scopes.includes('write')) throw new ApiError(403, 'FORBIDDEN', '该令牌无写入权限');

    const body = await parseBody(req, Body);

    switch (body.action) {
      case 'trash':
        return NextResponse.json(await trashItems(body.ids));
      case 'restore':
        return NextResponse.json(await restoreItems(body.ids));
      case 'purge':
        return NextResponse.json(await purgeItems(body.ids));
      case 'collection':
        return NextResponse.json(
          await bulkUpdate(body.ids, { collectionId: body.collectionId ?? null }),
        );
      default:
        return NextResponse.json(await bulkUpdate(body.ids, { status: body.action }));
    }
  } catch (err) {
    return jsonError(err);
  }
}
