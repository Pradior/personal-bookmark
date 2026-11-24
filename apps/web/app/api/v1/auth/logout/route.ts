import { NextResponse, type NextRequest } from 'next/server';
import { env } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest): Promise<NextResponse> {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(env.sessionCookie, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.publicBaseUrl.startsWith('https://'),
    path: '/',
    maxAge: 0,
  });
  return res;
}
