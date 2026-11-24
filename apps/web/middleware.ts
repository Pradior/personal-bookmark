import { NextResponse, type NextRequest } from 'next/server';

const SESSION_COOKIE = 'pb_session';

/**
 * 只做「有没有 cookie」的粗筛，用于把未登录用户挡到登录页。
 * 真正的验签在服务端（RSC 与 route handler），所以这里被绕过也不影响安全。
 * 刻意不 import 任何 node 模块 —— middleware 跑在 Edge runtime。
 */
export function middleware(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;

  if (
    pathname === '/login' ||
    pathname.startsWith('/api/v1/auth/login') ||
    pathname.startsWith('/api/v1/health') ||
    pathname.startsWith('/_next') ||
    pathname === '/favicon.ico' ||
    pathname === '/icon.svg'
  ) {
    return NextResponse.next();
  }

  const hasSession = req.cookies.has(SESSION_COOKIE);
  if (hasSession) return NextResponse.next();

  if (pathname.startsWith('/api/')) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: '未登录' } },
      { status: 401 },
    );
  }

  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg).*)'],
};
