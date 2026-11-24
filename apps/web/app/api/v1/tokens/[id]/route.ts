import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { accessToken, getDb } from '@pb/db';
import { authenticate } from '@/lib/session';
import { ApiError, jsonError } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const auth = await authenticate(req);
    if (!auth) throw new ApiError(401, 'UNAUTHORIZED', '未登录');
    if (!auth.scopes.includes('write')) {
      throw new ApiError(403, 'FORBIDDEN', '该令牌无管理权限');
    }

    const { id } = await ctx.params;
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuid.test(id)) throw new ApiError(400, 'BAD_REQUEST', 'id 不是合法 UUID');

    const db = getDb();
    const deleted = await db
      .delete(accessToken)
      .where(eq(accessToken.id, id))
      .returning({ id: accessToken.id });

    if (deleted.length === 0) throw new ApiError(404, 'NOT_FOUND', '令牌不存在');

    return NextResponse.json({ ok: true });
  } catch (err) {
    return jsonError(err);
  }
}
