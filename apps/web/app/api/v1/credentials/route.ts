import { NextResponse, type NextRequest } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { CredentialUpsert, type CredentialInfo } from '@pb/contract';
import { decryptSecret, encryptSecret, normalizeCookie } from '@pb/core';
import { getDb, siteCredential } from '@pb/db';
import { authenticate } from '@/lib/session';
import { ApiError, jsonError, parseBody } from '@/lib/api';
import { env } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function toInfo(row: typeof siteCredential.$inferSelect): CredentialInfo {
  let len = 0;
  try {
    len = decryptSecret(row.cookieCipher, env.authSecret).length;
  } catch {
    len = -1; // -1 表示解不开（多半是 AUTH_SECRET 换了）
  }
  return {
    id: row.id,
    domain: row.domain,
    userAgent: row.userAgent,
    referer: row.referer,
    enabled: row.enabled,
    note: row.note,
    cookieLength: len,
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const auth = await authenticate(req);
    if (!auth) throw new ApiError(401, 'UNAUTHORIZED', '未登录');

    const db = getDb();
    const rows = await db.select().from(siteCredential).orderBy(desc(siteCredential.updatedAt));
    return NextResponse.json({ credentials: rows.map(toInfo) });
  } catch (err) {
    return jsonError(err);
  }
}

/** 按 domain upsert：同一个域名只保留一份，重复提交等于更新 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const auth = await authenticate(req);
    if (!auth) throw new ApiError(401, 'UNAUTHORIZED', '未登录');
    if (!auth.scopes.includes('write')) {
      throw new ApiError(403, 'FORBIDDEN', '该令牌无管理权限');
    }

    const body = await parseBody(req, CredentialUpsert);
    const domain = body.domain.trim().toLowerCase().replace(/^\./, '');
    const cookie = normalizeCookie(body.cookie);

    if (cookie.length < 10) {
      throw new ApiError(400, 'BAD_REQUEST', 'Cookie 太短，确认是否粘贴完整');
    }

    const cipher = encryptSecret(cookie, env.authSecret);
    const db = getDb();

    const [row] = await db
      .insert(siteCredential)
      .values({
        domain,
        cookieCipher: cipher,
        userAgent: body.userAgent ?? null,
        referer: body.referer ?? null,
        note: body.note ?? null,
        enabled: body.enabled,
      })
      .onConflictDoUpdate({
        target: siteCredential.domain,
        set: {
          cookieCipher: cipher,
          userAgent: body.userAgent ?? null,
          referer: body.referer ?? null,
          note: body.note ?? null,
          enabled: body.enabled,
          updatedAt: new Date(),
        },
      })
      .returning();

    if (!row) throw new ApiError(500, 'INTERNAL', '保存失败');
    return NextResponse.json(toInfo(row), { status: 201 });
  } catch (err) {
    return jsonError(err);
  }
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  try {
    const auth = await authenticate(req);
    if (!auth) throw new ApiError(401, 'UNAUTHORIZED', '未登录');
    if (!auth.scopes.includes('write')) {
      throw new ApiError(403, 'FORBIDDEN', '该令牌无管理权限');
    }

    const id = new URL(req.url).searchParams.get('id');
    if (!id) throw new ApiError(400, 'BAD_REQUEST', '缺少 id');

    const db = getDb();
    const deleted = await db
      .delete(siteCredential)
      .where(eq(siteCredential.id, id))
      .returning({ id: siteCredential.id });

    if (deleted.length === 0) throw new ApiError(404, 'NOT_FOUND', '凭据不存在');
    return NextResponse.json({ ok: true });
  } catch (err) {
    return jsonError(err);
  }
}
