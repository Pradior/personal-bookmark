import { NextResponse, type NextRequest } from 'next/server';
import { eq, inArray } from 'drizzle-orm';
import { asset, assetVariant, getDb, item } from '@pb/db';
import { authenticate } from '@/lib/session';
import { ApiError, jsonError } from '@/lib/api';
import { resolveAssetPath } from '@/lib/storage';
import { existsSync, statSync } from 'node:fs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 条目诊断：图片为什么没出来。
 *
 * 这类问题光看界面无法定位 —— 可能是
 *   1. 下载失败（没建记录）
 *   2. 记录建了但变体没写
 *   3. 变体行在、但磁盘上没文件（写失败/路径不一致/卷没挂上）
 * 所以把三层状态一次列出来对照。
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const auth = await authenticate(req);
    if (!auth) throw new ApiError(401, 'UNAUTHORIZED', '未登录');

    const { id } = await ctx.params;
    if (!UUID_RE.test(id)) throw new ApiError(400, 'BAD_REQUEST', 'id 不是合法 UUID');

    const db = getDb();
    const rows = await db.select().from(item).where(eq(item.id, id)).limit(1);
    const row = rows[0];
    if (!row) throw new ApiError(404, 'NOT_FOUND', '条目不存在');

    const assets = await db.select().from(asset).where(eq(asset.itemId, id));
    const assetIds = assets.map((a) => a.id);
    const variants = assetIds.length
      ? await db.select().from(assetVariant).where(inArray(assetVariant.assetId, assetIds))
      : [];

    const byAsset = new Map<string, typeof variants>();
    for (const v of variants) {
      const list = byAsset.get(v.assetId) ?? [];
      list.push(v);
      byAsset.set(v.assetId, list);
    }

    // 正文里引用了多少个 assetId —— 和数据库对一下就知道有没有"引用了不存在的图"
    const referenced = [...(row.contentHtml ?? '').matchAll(/\/api\/v1\/assets\/([0-9a-f-]{36})/g)]
      .map((m) => m[1] as string);
    const referencedIds = [...new Set(referenced)];

    const assetRows = assets.map((a) => {
      const vs = byAsset.get(a.id) ?? [];
      return {
        id: a.id,
        mime: a.mime,
        bytes: a.bytes,
        width: a.width,
        height: a.height,
        animated: a.animated,
        originHost: (() => {
          try {
            return a.originUrl ? new URL(a.originUrl).host : null;
          } catch {
            return null;
          }
        })(),
        originPath: (() => {
          try {
            return a.originUrl ? new URL(a.originUrl).pathname : null;
          } catch {
            return null;
          }
        })(),
        sourceStatus: a.sourceStatus,
        variants: vs.map((v) => {
          let fileOk = false;
          let fileBytes: number | null = null;
          let fileError: string | null = null;
          try {
            const p = resolveAssetPath(v.storageKey);
            fileOk = existsSync(p);
            if (fileOk) fileBytes = statSync(p).size;
          } catch (e) {
            fileError = e instanceof Error ? e.message : String(e);
          }
          return {
            variant: v.variant,
            storageKey: v.storageKey,
            mime: v.mime,
            bytesInDb: v.bytes,
            fileExists: fileOk,
            fileBytes,
            fileError,
          };
        }),
      };
    });

    // 一句话结论：不用看懂 JSON 也能判断该查哪一层
    const missingFiles = assetRows.flatMap((a) =>
      a.variants.filter((v) => !v.fileExists).map((v) => `${a.id}:${v.variant}`),
    );
    const noVariants = assetRows.filter((a) => a.variants.length === 0).map((a) => a.id);

    let verdict: string;
    if (assets.length === 0) {
      verdict =
        '没有图片记录：下载阶段就全失败了。看 worker 日志里的 [assets] 行，多半是防盗链/需要 cookie。';
    } else if (missingFiles.length > 0) {
      verdict = `数据库有记录但磁盘没文件（${missingFiles.length} 个变体）：检查 ASSETS_DIR 卷是否两个容器都挂到了同一路径。`;
    } else if (noVariants.length > 0) {
      verdict = `有 ${noVariants.length} 个资源没有任何变体：转码那一步没写成功。`;
    } else if (referencedIds.some((rid) => !assetIds.includes(rid))) {
      verdict = '正文引用了不存在的资源 id：清洗阶段映射错了。';
    } else {
      verdict =
        '记录、变体、磁盘文件三者一致。如果界面仍不显示，问题在前端（iframe 相对路径或认证 cookie）。';
    }

    return NextResponse.json({
      verdict,
      item: {
        id: row.id,
        source: row.source,
        fetchState: row.fetchState,
        fetchError: row.fetchError,
        title: row.title,
        contentTextLength: (row.contentText ?? '').length,
        adapterId: row.adapterId,
        meta: row.meta,
      },
      summary: {
        assetsInDb: assets.length,
        variantsInDb: variants.length,
        referencedInHtml: referencedIds.length,
        referencedButMissing: referencedIds.filter((rid) => !assetIds.includes(rid)).length,
      },
      assets: assetRows,

    });
  } catch (err) {
    return jsonError(err);
  }
}
