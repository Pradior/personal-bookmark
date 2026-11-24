import { and, eq } from 'drizzle-orm';
import { asset, assetVariant, getDb } from '@pb/db';
import { readAsset } from './storage';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(id: string): boolean {
  return UUID_RE.test(id);
}

/** 读取某个变体并返回可缓存的响应（支持 If-None-Match） */
export async function respondWithVariant(
  assetId: string,
  variant: 'display' | 'thumb',
  req: Request,
): Promise<Response> {
  if (!isUuid(assetId)) {
    return jsonError(400, 'BAD_REQUEST', 'assetId 不是合法 UUID');
  }

  const db = getDb();
  const rows = await db
    .select({ storageKey: assetVariant.storageKey, mime: assetVariant.mime })
    .from(assetVariant)
    .where(and(eq(assetVariant.assetId, assetId), eq(assetVariant.variant, variant)))
    .limit(1);

  const row = rows[0];
  if (!row) {
    return jsonError(404, 'NOT_FOUND', `该资源没有 ${variant} 变体`);
  }

  try {
    const file = await readAsset(row.storageKey);
    const inm = req.headers.get('if-none-match');
    if (inm && inm === file.etag) {
      return new Response(null, { status: 304, headers: { etag: file.etag } });
    }

    return new Response(new Uint8Array(file.body), {
      status: 200,
      headers: {
        'content-type': row.mime,
        'content-length': String(file.body.byteLength),
        etag: file.etag,
        // 内容寻址 + 文件名带 assetId，可以永久缓存
        'cache-control': 'public, max-age=31536000, immutable',
      },
    });
  } catch (err) {
    console.error('[assets] 读文件失败', err);
    return jsonError(404, 'NOT_FOUND', '资源文件不存在（可能尚未转码完成）');
  }
}

export function jsonError(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}

export { asset };
