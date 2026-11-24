/**
 * 「预览原图」按需回源（ADR-013）
 *
 * 原图不落盘，只在用户点击时才去源站拉。三个必须做的事：
 *   1. 带 origin_referer / origin_user_agent —— 否则公众号图片 403
 *   2. SSRF 防护 —— 这个端点本质是"服务端替用户访问任意 URL"
 *   3. 内存 LRU —— 连看几张图别反复回源；但不落盘，重启即失效
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { eq } from 'drizzle-orm';
import { asset, getDb } from '@pb/db';
import { env } from './env';

type Cached = { body: Buffer; mime: string };
const cache = new Map<string, Cached>();

function cacheGet(key: string): Cached | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  // 触达即刷新（LRU）
  cache.delete(key);
  cache.set(key, hit);
  return hit;
}

function cacheSet(key: string, value: Cached): void {
  if (env.sourceCacheItems <= 0) return;
  cache.set(key, value);
  while (cache.size > env.sourceCacheItems) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

function err(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}

function isPrivateIp(ip: string): boolean {
  const v = ip.trim().toLowerCase();

  if (isIP(v) === 4) {
    const parts = v.split('.').map(Number);
    const [a, b] = [parts[0] ?? 0, parts[1] ?? 0];
    if (a === 0 || a === 127) return true;
    if (a === 10) return true;
    if (a === 169 && b === 254) return true; // 链路本地，含云元数据 169.254.169.254
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // 组播 / 保留
    return false;
  }

  if (isIP(v) === 6) {
    if (v === '::' || v === '::1') return true;
    if (v.startsWith('fc') || v.startsWith('fd')) return true; // ULA
    if (v.startsWith('fe80')) return true; // 链路本地
    if (v.startsWith('::ffff:')) return isPrivateIp(v.slice(7)); // 映射地址
    return false;
  }

  return true; // 解析不出 IP 一律拒绝
}

async function assertFetchable(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('源地址不合法');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`不支持的协议: ${url.protocol}`);
  }

  const host = url.hostname;
  if (isIP(host)) {
    if (isPrivateIp(host)) throw new Error('拒绝访问内网地址');
    return url;
  }

  const records = await lookup(host, { all: true });
  if (records.length === 0) throw new Error('域名解析失败');
  if (records.some((r) => isPrivateIp(r.address))) {
    throw new Error('拒绝访问内网地址');
  }
  return url;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function proxySource(assetId: string): Promise<Response> {
  if (!UUID_RE.test(assetId)) return err(400, 'BAD_REQUEST', 'assetId 不是合法 UUID');

  const db = getDb();
  const rows = await db.select().from(asset).where(eq(asset.id, assetId)).limit(1);
  const row = rows[0];
  if (!row) return err(404, 'NOT_FOUND', '资源不存在');

  if (!row.originUrl || !row.sourceAvailable) {
    return err(404, 'SOURCE_UNAVAILABLE', '这张图没有可回源的原始地址');
  }

  const cached = cacheGet(assetId);
  if (cached) {
    return new Response(new Uint8Array(cached.body), {
      headers: {
        'content-type': cached.mime,
        'content-length': String(cached.body.byteLength),
        'cache-control': 'private, max-age=300',
        'x-pb-cache': 'hit',
      },
    });
  }

  try {
    const url = await assertFetchable(row.originUrl);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), env.sourceFetchTimeoutMs);

    let res: globalThis.Response;
    try {
      const headers: Record<string, string> = {
        accept: 'image/avif,image/webp,image/*,*/*;q=0.8',
      };
      if (row.originReferer) headers.referer = row.originReferer;
      if (row.originUserAgent) headers['user-agent'] = row.originUserAgent;

      res = await fetch(url, { headers, redirect: 'follow', signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      await markFailed(assetId, row.sourceFailCount + 1, res.status === 404 || res.status === 410);
      return err(502, 'SOURCE_FETCH_FAILED', `源站返回 ${res.status}，原图可能已被删除`);
    }

    const declared = Number(res.headers.get('content-length') ?? '0');
    if (declared && declared > env.maxSourceBytes) {
      return err(413, 'SOURCE_TOO_LARGE', `原图超过 ${Math.round(env.maxSourceBytes / 1024 / 1024)}MB`);
    }

    const body = Buffer.from(await res.arrayBuffer());
    if (body.byteLength > env.maxSourceBytes) {
      return err(413, 'SOURCE_TOO_LARGE', '原图体积超限');
    }

    const mime = res.headers.get('content-type') ?? 'application/octet-stream';
    if (!mime.startsWith('image/')) {
      await markFailed(assetId, row.sourceFailCount + 1, false);
      return err(502, 'SOURCE_NOT_IMAGE', '源地址返回的不是图片');
    }

    cacheSet(assetId, { body, mime });

    await db
      .update(asset)
      .set({ sourceStatus: 'ok', sourceCheckedAt: new Date(), sourceFailCount: 0 })
      .where(eq(asset.id, assetId));

    return new Response(new Uint8Array(body), {
      headers: {
        'content-type': mime,
        'content-length': String(body.byteLength),
        'cache-control': 'private, max-age=300',
        'x-pb-cache': 'miss',
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await markFailed(assetId, row.sourceFailCount + 1, false);
    console.warn(`[source] 回源失败 ${assetId}: ${message}`);
    return err(502, 'SOURCE_FETCH_FAILED', message);
  }
}

async function markFailed(assetId: string, failCount: number, gone: boolean): Promise<void> {
  try {
    await getDb()
      .update(asset)
      .set({
        sourceStatus: gone || failCount >= 3 ? 'gone' : 'failed',
        sourceCheckedAt: new Date(),
        sourceFailCount: failCount,
        // 连续失败就彻底关掉入口，UI 不再显示按钮
        sourceAvailable: !(gone || failCount >= 3),
      })
      .where(eq(asset.id, assetId));
  } catch (err) {
    console.error('[source] 记录失败状态出错', err);
  }
}
