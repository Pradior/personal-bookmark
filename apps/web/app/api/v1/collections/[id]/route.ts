import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { authenticate } from '@/lib/session';
import { ApiError, jsonError, parseBody } from '@/lib/api';
import { deleteCollection, renameCollection } from '@/lib/taxonomy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PatchBody = z.object({ name: z.string().min(1).max(120) });

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

    const body = await parseBody(req, PatchBody);
    const ok = await renameCollection(id, body.name);
    if (!ok) throw new ApiError(404, 'NOT_FOUND', '集合不存在');
    return NextResponse.json({ ok: true });
  } catch (err) {
    return jsonError(err);
  }
}

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

    // 条目的 collection_id 由外键 set null，不会连带删内容
    const ok = await deleteCollection(id);
    if (!ok) throw new ApiError(404, 'NOT_FOUND', '集合不存在');
    return NextResponse.json({ ok: true });
  } catch (err) {
    return jsonError(err);
  }
}
