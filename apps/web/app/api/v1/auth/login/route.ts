import { NextResponse, type NextRequest } from 'next/server';
import { LoginRequest } from '@pb/contract';
import { createSessionToken, getAuthFile, verifyPassword } from '@/lib/auth';
import { env } from '@/lib/env';
import { ApiError, jsonError, parseBody } from '@/lib/api';
import { clientKey, rateLimit } from '@/lib/ratelimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    if (!rateLimit(clientKey(req, 'login'), 5, 60_000)) {
      throw new ApiError(429, 'RATE_LIMITED', '尝试过于频繁，请稍后再试');
    }

    const body = await parseBody(req, LoginRequest);
    const auth = await getAuthFile();

    if (!verifyPassword(body.password, auth.passwordHash)) {
      throw new ApiError(401, 'UNAUTHORIZED', '密码不正确');
    }

    const token = await createSessionToken();
    const res = NextResponse.json({ ok: true });
    res.cookies.set(env.sessionCookie, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: env.publicBaseUrl.startsWith('https://'),
      path: '/',
      maxAge: env.sessionDays * 24 * 60 * 60,
    });
    return res;
  } catch (err) {
    return jsonError(err);
  }
}
