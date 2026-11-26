/**
 * 速记的图片落库（web 侧同步处理）
 *
 * 为什么在 web 里同步做、而不走 worker 队列：
 *  - 速记要求"点了就存下来"，走队列反而慢
 *  - 但**图片派生逻辑必须与 worker 共用同一份**（@pb/core/image），
 *    否则又会出现两边 MIME 不一致导致裂图那种问题
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { and, eq } from 'drizzle-orm';
import { asset, assetVariant, type Database } from '@pb/db';
import { DEFAULT_RENDER, extForMime, normalizeMime } from '@pb/core';
import { env } from './env';

export type IngestedUpload = {
  assetId: string;
  width?: number;
  height?: number;
};

export type UploadFailure = {
  name: string;
  reason: string;
};

/** 单张图上限：手机直出照片 8–12MB，给到 15MB */
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
/** 一条速记最多几张图 */
export const MAX_UPLOAD_COUNT = 9;

type Variants = {
  sourceMime: string;
  animated: boolean;
  sourceWidth?: number;
  sourceHeight?: number;
  display: { buf: Buffer; mime: string; width?: number; height?: number };
  thumb: { buf: Buffer; mime: string; width?: number; height?: number };
};

/**
 * 派生两档变体。
 *
 * 这里有一份与 core/imageVariants.ts 平行的实现，原因见文件头：
 * core 主入口不能引 sharp（web 会把它编进包）。为了不让两者漂移：
 *   - 参数与 MIME 映射都从 @pb/core 取（DEFAULT_RENDER / normalizeMime / extForMime）
 *   - 两边都有自检（core 的 check:image 覆盖同一套规则）
 */
async function renderVariants(input: Buffer): Promise<Variants> {
  const meta = await sharp(input, { animated: true }).metadata();
  const sourceMime = normalizeMime(meta.format);
  const animated = (meta.pages ?? 1) > 1;
  const isSvg = sourceMime === 'image/svg+xml';

  let display: Variants['display'];
  if (animated || isSvg) {
    display = { buf: input, mime: sourceMime, width: meta.width, height: meta.height };
  } else {
    const out = await sharp(input)
      .rotate()
      .resize({
        width: DEFAULT_RENDER.maxEdge,
        height: DEFAULT_RENDER.maxEdge,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: DEFAULT_RENDER.quality })
      .toBuffer({ resolveWithObject: true });
    display = { buf: out.data, mime: 'image/webp', width: out.info.width, height: out.info.height };
  }

  const thumbOut = await sharp(input, { animated: false })
    .rotate()
    .resize({ width: 400, height: 400, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 75 })
    .toBuffer({ resolveWithObject: true });

  return {
    sourceMime,
    animated,
    sourceWidth: meta.width,
    sourceHeight: meta.height,
    display,
    thumb: {
      buf: thumbOut.data,
      mime: 'image/webp',
      width: thumbOut.info.width,
      height: thumbOut.info.height,
    },
  };
}

/**
 * 把一张上传的图变成 asset + 两档变体。
 * 与 worker 的 ingestImage 同源：下载换成内存 buffer，其余完全一致。
 */
export async function ingestUpload(
  db: Database,
  itemId: string,
  upload: { buffer: Buffer; name: string },
): Promise<IngestedUpload | null> {
  const sha256 = createHash('sha256').update(upload.buffer).digest('hex');

  // 同一条速记里重复贴同一张图 → 只存一份
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
    };
  }

  const variants = await renderVariants(upload.buffer);

  // 速记是用户自己选的图，不做"小图=图标"过滤：截图、表情都可能很小
  const assetId = randomUUID();
  const bucket = sha256.slice(0, 2);
  const base = join(env.assetsDir, bucket);
  const displayKey = `${bucket}/${assetId}-display.${extForMime(variants.display.mime)}`;
  const thumbKey = `${bucket}/${assetId}-thumb.webp`;

  await mkdir(base, { recursive: true });
  await writeFile(join(env.assetsDir, displayKey), variants.display.buf);
  await writeFile(join(env.assetsDir, thumbKey), variants.thumb.buf);

  await db.insert(asset).values({
    id: assetId,
    itemId,
    kind: 'image',
    sha256,
    sourceMime: variants.sourceMime,
    sourceWidth: variants.sourceWidth,
    sourceHeight: variants.sourceHeight,
    sourceBytes: upload.buffer.byteLength,
    mime: variants.display.mime,
    width: variants.display.width,
    height: variants.display.height,
    bytes: variants.display.buf.byteLength,
    animated: variants.animated,
    // 来自本地上传，没有来源 URL
    originUrl: null,
    sourceAvailable: true,
    sourceStatus: 'unknown',
  });

  await db.insert(assetVariant).values([
    {
      assetId,
      variant: 'display',
      storageKey: displayKey,
      mime: variants.display.mime,
      bytes: variants.display.buf.byteLength,
      width: variants.display.width,
      height: variants.display.height,
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
    width: variants.display.width,
    height: variants.display.height,
  };
}
