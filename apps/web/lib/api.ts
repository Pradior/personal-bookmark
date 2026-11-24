import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { ErrorCode } from '@pb/contract';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly extra?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function jsonOk(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

const DB_DOWN_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'ETIMEDOUT',
  '28P01', // 密码错误
  '3D000', // 数据库不存在
  '57P03', // 正在启动
]);

/** 数据库没起来是最常见的新手坑，单独识别出来给明确提示 */
function isDbDown(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  if (!e) return false;
  if (e.code && DB_DOWN_CODES.has(e.code)) return true;
  if (typeof e.message === 'string') {
    if (e.message.includes('DATABASE_URL')) return true;
    if (e.message.includes('ECONNREFUSED')) return true;
    if (e.message.includes('Connection terminated')) return true;
  }
  return false;
}

export function jsonError(err: unknown): NextResponse {
  if (err instanceof ApiError) {
    return NextResponse.json(
      { error: { code: err.code, message: err.message, ...(err.extra ?? {}) } },
      { status: err.status },
    );
  }

  if (isDbDown(err)) {
    console.error('[pb] 数据库不可用', err);
    return NextResponse.json(
      {
        error: {
          code: 'DB_UNAVAILABLE',
          message:
            '数据库未连接。先启动 pb-db（docker compose up -d pb-db），再运行 pnpm db:migrate。',
        },
      },
      { status: 503 },
    );
  }

  const traceId = Math.random().toString(36).slice(2, 10);
  console.error(`[pb] 未预期错误 trace=${traceId}`, err);
  return NextResponse.json(
    { error: { code: 'INTERNAL', message: '服务器内部错误', traceId } },
    { status: 500 },
  );
}

/** zod 校验请求体；失败抛 400 并把 issue 一并返回，便于调试 */
export async function parseBody<S extends z.ZodTypeAny>(
  req: Request,
  schema: S,
): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new ApiError(400, 'BAD_REQUEST', '请求体不是合法 JSON');
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError(400, 'BAD_REQUEST', '参数校验失败', {
      issues: parsed.error.issues,
    });
  }
  return parsed.data;
}

export function parseQuery<S extends z.ZodTypeAny>(req: Request, schema: S): z.infer<S> {
  const url = new URL(req.url);
  const obj: Record<string, string | string[]> = {};
  for (const [k, v] of url.searchParams.entries()) {
    const existing = obj[k];
    if (existing === undefined) obj[k] = v;
    else if (Array.isArray(existing)) existing.push(v);
    else obj[k] = [existing, v];
  }
  const parsed = schema.safeParse(obj);
  if (!parsed.success) {
    throw new ApiError(400, 'BAD_REQUEST', '查询参数校验失败', {
      issues: parsed.error.issues,
    });
  }
  return parsed.data;
}
