import { NextResponse, type NextRequest } from 'next/server';
import type { AuthMe } from '@pb/contract';
import { authenticate } from '@/lib/session';
import { ApiError, jsonError } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const auth = await authenticate(req);
    if (!auth) throw new ApiError(401, 'UNAUTHORIZED', '未登录');

    const body: AuthMe = {
      authenticated: true,
      user: 'owner',
      authMethod: auth.method,
    };
    return NextResponse.json(body);
  } catch (err) {
    return jsonError(err);
  }
}
