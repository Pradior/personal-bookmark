import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { authenticate } from '@/lib/session';
import { ApiError, jsonError, parseBody } from '@/lib/api';
import { createCollection, listCollections } from '@/lib/taxonomy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CreateBody = z.object({
  name: z.string().min(1).max(120),
});

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const auth = await authenticate(req);
    if (!auth) throw new ApiError(401, 'UNAUTHORIZED', '未登录');
    return NextResponse.json({ collections: await listCollections() });
  } catch (err) {
    return jsonError(err);
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const auth = await authenticate(req);
    if (!auth) throw new ApiError(401, 'UNAUTHORIZED', '未登录');
    if (!auth.scopes.includes('write')) throw new ApiError(403, 'FORBIDDEN', '该令牌无写入权限');

    const body = await parseBody(req, CreateBody);
    const created = await createCollection(body.name);
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    return jsonError(err);
  }
}
