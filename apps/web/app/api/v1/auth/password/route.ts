import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getAuthFile, setPassword, verifyPassword } from '@/lib/auth';
import { authenticate } from '@/lib/session';
import { env } from '@/lib/env';
import { ApiError, jsonError, parseBody } from '@/lib/api';
import { clientKey, rateLimit } from '@/lib/ratelimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(8).max(200),
});

/**
 * 修改管理员密码
 *
 * 要求验证当前密码：只有 cookie 不够。否则 cookie 一旦泄露，
 * 攻击者就能直接改密码把主人锁在外面。
 *
 * 成功后 sessionEpoch +1，**所有会话（含本次）失效**，前端要引导重新登录。
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const auth = await authenticate(req);
    if (!auth) throw new ApiError(401, 'UNAUTHORIZED', '未登录');
    if (!auth.scopes.includes('write')) throw new ApiError(403, 'FORBIDDEN', '该令牌无写入权限');

    if (!rateLimit(clientKey(req, 'password'), 5, 60_000)) {
      throw new ApiError(429, 'RATE_LIMITED', '尝试过于频繁，请稍后再试');
    }

    const body = await parseBody(req, Body);

    const file = await getAuthFile();
    if (!verifyPassword(body.currentPassword, file.passwordHash)) {
      throw new ApiError(400, 'BAD_REQUEST', '当前密码不正确');
    }

    if (body.currentPassword === body.newPassword) {
      throw new ApiError(400, 'BAD_REQUEST', '新密码不能和当前密码相同');
    }

    await setPassword(body.newPassword);

    // 会话已作废，顺手把 cookie 清掉，省得前端拿着一个废 token 乱撞
    const res = NextResponse.json({ ok: true, requiresRelogin: true });
    res.cookies.set(env.sessionCookie, '', { path: '/', maxAge: 0 });
    return res;
  } catch (err) {
    return jsonError(err);
  }
}
