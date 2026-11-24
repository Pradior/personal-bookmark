import { NextResponse, type NextRequest } from 'next/server';
import { desc } from 'drizzle-orm';
import { TokenCreateRequest, type TokenCreated, type TokenInfo } from '@pb/contract';
import { accessToken, getDb } from '@pb/db';
import { authenticate } from '@/lib/session';
import { ApiError, jsonError, parseBody } from '@/lib/api';
import { generatePat } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const auth = await authenticate(req);
    if (!auth) throw new ApiError(401, 'UNAUTHORIZED', '未登录');
    if (!auth.scopes.includes('write')) {
      throw new ApiError(403, 'FORBIDDEN', '该令牌无管理权限');
    }

    const db = getDb();
    const rows = await db
      .select({
        id: accessToken.id,
        name: accessToken.name,
        prefix: accessToken.prefix,
        scopes: accessToken.scopes,
        lastUsedAt: accessToken.lastUsedAt,
        expiresAt: accessToken.expiresAt,
        createdAt: accessToken.createdAt,
      })
      .from(accessToken)
      .orderBy(desc(accessToken.createdAt));

    const tokens: TokenInfo[] = rows.map((r) => ({
      id: r.id,
      name: r.name,
      prefix: r.prefix,
      scopes: r.scopes,
      lastUsedAt: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
      expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
    }));

    return NextResponse.json({ tokens });
  } catch (err) {
    return jsonError(err);
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const auth = await authenticate(req);
    if (!auth) throw new ApiError(401, 'UNAUTHORIZED', '未登录');
    if (!auth.scopes.includes('write')) {
      throw new ApiError(403, 'FORBIDDEN', '该令牌无管理权限');
    }

    const body = await parseBody(req, TokenCreateRequest);
    const generated = generatePat();
    const expiresAt = body.expiresInDays
      ? new Date(Date.now() + body.expiresInDays * 24 * 60 * 60 * 1000)
      : null;

    const db = getDb();
    const [row] = await db
      .insert(accessToken)
      .values({
        name: body.name,
        tokenHash: generated.hash,
        prefix: generated.prefix,
        scopes: body.scopes,
        expiresAt,
      })
      .returning({
        id: accessToken.id,
        name: accessToken.name,
        prefix: accessToken.prefix,
        scopes: accessToken.scopes,
        lastUsedAt: accessToken.lastUsedAt,
        expiresAt: accessToken.expiresAt,
        createdAt: accessToken.createdAt,
      });

    if (!row) throw new ApiError(500, 'INTERNAL', '创建令牌失败');

    const created: TokenCreated = {
      id: row.id,
      name: row.name,
      prefix: row.prefix,
      scopes: row.scopes,
      lastUsedAt: null,
      expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      token: generated.token,
    };

    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    return jsonError(err);
  }
}
