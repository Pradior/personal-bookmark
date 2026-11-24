import { NextResponse } from 'next/server';
import { ping } from '@pb/db';
import { APP_VERSION, env } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 无认证的健康检查：给容器 healthcheck 与首启排障用 */
export async function GET(): Promise<NextResponse> {
  const db = await ping();
  return NextResponse.json(
    {
      ok: db,
      db,
      app: env.appName,
      version: APP_VERSION,
    },
    { status: db ? 200 : 503 },
  );
}
