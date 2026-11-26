import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { authenticate } from '@/lib/session';
import { ApiError, jsonError, parseBody } from '@/lib/api';
import { attachTag, detachTag, tagsOf } from '@/lib/taxonomy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const AttachBody = z.object({ name: z.string().min(1).max(64) });

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const auth = await authenticate(req);
    if (!auth) throw new ApiError(401, 'UNAUTHORIZED', '未登录');

    const { id } = await ctx.params;
    if (!UUID_RE.test(id)) throw new ApiError(400, 'BAD_REQUEST', 'id 不是合法 UUID');

    const map = await tagsOf([id]);
    return NextResponse.json({ tags: map.get(id) ?? [] });
  } catch (err) {
    return jsonError(err);
  }
}

/** 打标签：按名字 upsert，幂等 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const auth = await authenticate(req);
    if (!auth) throw new ApiError(401, 'UNAUTHORIZED', '未登录');
    if (!auth.scopes.includes('write')) throw new ApiError(403, 'FORBIDDEN', '该令牌无写入权限');

    const { id } = await ctx.params;
    if (!UUID_RE.test(id)) throw new ApiError(400, 'BAD_REQUEST', 'id 不是合法 UUID');

    const body = await parseBody(req, AttachBody);
    const name = await attachTag(id, body.name);
    return NextResponse.json({ ok: true, name }, { status: 201 });
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

    const name = new URL(req.url).searchParams.get('name');
    if (!name) throw new ApiError(400, 'BAD_REQUEST', '缺少 name');

    const ok = await detachTag(id, name);
    if (!ok) throw new ApiError(404, 'NOT_FOUND', '没有这个标签');
    return NextResponse.json({ ok: true });
  } catch (err) {
    return jsonError(err);
  }
}
