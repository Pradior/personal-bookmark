/**
 * 图片管线（SPEC T1.5 / ADR-013）
 *
 * 只存两档：display（≤2000 q85）与 thumb（400 q75）。
 * 原图**不落盘**——它只在内存里停留一次，转码完即释放。
 * （SPEC 原写"源文件只进 /tmp"，用 Buffer 更彻底：连临时文件都没有）
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { asset, assetVariant, type Database } from '@pb/db';
import { fetchBinary } from '@pb/core';
import { extForMime, renderVariants } from '@pb/core/image';

export type IngestOptions = {
  url: string;
  referer?: string;
  userAgent?: string;
  /** 站点登录态（部分图床校验 referer+cookie） */
  cookie?: string;
  itemId: string;
  assetsDir: string;
  maxBytes: number;
  displayMaxEdge: number;
  displayQuality: number;
};

export type Ingested = {
  assetId: string;
  width?: number;
  height?: number;
  sourceAvailable: boolean;
};


/**
 * 抓取一张图 → 派生两档 → 落盘 → 写库。
 * 失败返回 null（单张图失败不该让整篇文章失败）。
 */
export async function ingestImage(
  db: Database,
  options: IngestOptions,
): Promise<Ingested | null> {
  const {
    url,
    referer,
    userAgent,
    cookie,
    itemId,
    assetsDir,
    maxBytes,
    displayMaxEdge,
    displayQuality,
  } = options;

  try {
    // 1) 下载（带 Referer，否则公众号图片 403）
    const res = await fetchBinary(url, {
      referer,
      userAgent,
      cookie,
      maxBytes,
      timeoutMs: 20_000,
      retries: 2,
    });

    const sha256 = createHash('sha256').update(res.body).digest('hex');

    // 2) 同一篇文章内去重（同图出现两次只存一份）
    const existing = await db
      .select({ id: asset.id, width: asset.width, height: asset.height })
      .from(asset)
      .where(and(eq(asset.itemId, itemId), eq(asset.sha256, sha256)))
      .limit(1);

    if (existing[0]) {
      return {
        assetId: existing[0].id,
        width: existing[0].width ?? undefined,
        height: existing[0].height ?? undefined,
        sourceAvailable: true,
      };
    }

    // 3) 派生两档（实现收敛在 @pb/core/image，速记上传也走同一份）
    const variants = await renderVariants(res.body, {
      maxEdge: displayMaxEdge,
      quality: displayQuality,
    });

    // 图标/头像/角标一律跳过：比这还小的东西不会是正文配图
    if (variants.tooSmall) {
      console.log(
        `[assets] 跳过小图 ${variants.sourceWidth}×${variants.sourceHeight}: ${url.slice(0, 80)}`,
      );
      return null;
    }

    const assetId = randomUUID();
    const bucket = sha256.slice(0, 2);
    const base = join(assetsDir, bucket);

    const displayBuf = variants.display.buf;
    const displayMime = variants.display.mime;
    const displayWidth = variants.display.width;
    const displayHeight = variants.display.height;

    // 5) 落盘（用 assetId 命名，避免不同条目同图互相覆盖）
    const displayKey = `${bucket}/${assetId}-display.${extForMime(displayMime)}`;
    const thumbKey = `${bucket}/${assetId}-thumb.webp`;

    await mkdir(base, { recursive: true });
    await writeFile(join(assetsDir, displayKey), displayBuf);
    await writeFile(join(assetsDir, thumbKey), variants.thumb.buf);

    // 6) 写库
    await db.insert(asset).values({
      id: assetId,
      itemId,
      kind: 'image',
      sha256,
      sourceMime: variants.sourceMime,
      sourceWidth: variants.sourceWidth,
      sourceHeight: variants.sourceHeight,
      sourceBytes: res.bytes,
      mime: displayMime,
      width: displayWidth,
      height: displayHeight,
      bytes: displayBuf.byteLength,
      animated: variants.animated,
      originUrl: url,
      originReferer: referer,
      originUserAgent: userAgent,
      sourceAvailable: true,
      sourceStatus: 'unknown',
    });

    await db.insert(assetVariant).values([
      {
        assetId,
        variant: 'display',
        storageKey: displayKey,
        mime: displayMime,
        bytes: displayBuf.byteLength,
        width: displayWidth,
        height: displayHeight,
      },
      {
        assetId,
        variant: 'thumb',
        storageKey: thumbKey,
        mime: 'image/webp',
        bytes: variants.thumb.buf.byteLength,
        width: variants.thumb.width,
        height: variants.thumb.height,
      },
    ]);

    return {
      assetId,
      width: displayWidth,
      height: displayHeight,
      sourceAvailable: true,
    };
  } catch (err) {
    console.warn(`[assets] 图片处理失败（跳过）: ${url.slice(0, 100)} → ${(err as Error).message}`);
    return null;
  }
}
