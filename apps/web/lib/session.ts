import { cookies } from 'next/headers';
import { eq } from 'drizzle-orm';
import { getDb, accessToken } from '@pb/db';
import { env } from './env';
import { hashPat, looksLikePat, verifySessionToken } from './auth';

export type AuthContext = {
  method: 'session' | 'pat';
  scopes: string[];
};

function readCookieFromHeader(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (key === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

/** PAT 校验：走库，顺带检查过期 */
async function verifyPat(token: string): Promise<AuthContext | null> {
  try {
    const db = getDb();
    const rows = await db
      .select({
        id: accessToken.id,
        scopes: accessToken.scopes,
        expiresAt: accessToken.expiresAt,
      })
      .from(accessToken)
      .where(eq(accessToken.tokenHash, hashPat(token)))
      .limit(1);

    const row = rows[0];
    if (!row) return null;
    if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return null;

    // TODO(Sprint 1): 异步 touch lastUsedAt，别让每次请求多一次写
    return { method: 'pat', scopes: row.scopes };
  } catch {
    // DB 不可用时不要把 Bearer 当成有效
    return null;
  }
}

/**
 * 统一认证入口。
 * - 传了 Request：先看 Authorization: Bearer，再看 cookie
 * - 没传（RSC 场景）：只读 cookie（next/headers，异步 API）
 */
export async function authenticate(req?: Request): Promise<AuthContext | null> {
  const header = req?.headers.get('authorization') ?? null;
  if (header && header.toLowerCase().startsWith('bearer ')) {
    const token = header.slice(7).trim();
    if (!looksLikePat(token)) return null;
    return verifyPat(token);
  }

  let sessionToken: string | null = null;
  if (req) {
    sessionToken = readCookieFromHeader(req.headers.get('cookie'), env.sessionCookie);
  } else {
    const store = await cookies();
    sessionToken = store.get(env.sessionCookie)?.value ?? null;
  }

  if (!sessionToken) return null;
  const valid = await verifySessionToken(sessionToken);
  if (!valid) return null;
  return { method: 'session', scopes: ['capture', 'read', 'write'] };
}

export function hasScope(ctx: AuthContext | null, scope: string): boolean {
  if (!ctx) return false;
  return ctx.scopes.includes(scope);
}
