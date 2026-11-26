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
import sharp from 'sharp';
import { and, eq } from 'drizzle-orm';
import { asset, assetVariant, type Database } from '@pb/db';
import { fetchBinary } from '@pb/core';

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

const EXT: Record<string, string> = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
  'image/svg': 'svg',
};

function extFor(mime: string): string {
  return EXT[mime.split(';')[0]?.trim().toLowerCase() ?? ''] ?? 'bin';
}

/**
 * sharp 的 metadata().format 给的是 'svg'，直接拼成 `image/svg` 是错的
 * （浏览器只认 `image/svg+xml`，否则拒绝渲染 → 裂图）。
 * 这里统一把格式名规范化成正确的 MIME。
 */
function normalizeMime(format: string | undefined, fallback: string): string {
  const f = (format ?? '').trim().toLowerCase();
  const map: Record<string, string> = {
    svg: 'image/svg+xml',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
    avif: 'image/avif',
    heif: 'image/heif',
    tiff: 'image/tiff',
  };
  return map[f] ?? (fallback.split(';')[0]?.trim() || 'application/octet-stream');
}

/**
 * 太小的图大概率是图标、头像、角标，不是正文配图。
 * 小红书空壳页里唯一的 xhscdn 图片就是一个 32×32 的搜索图标，
 * 之前被当成笔记配图存了下来（见 2026-11-26 诊断）。
 */
const MIN_EDGE = Number(process.env.MIN_ASSET_EDGE ?? 120);

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

    // 3) 探查源图
    const probe = sharp(res.body, { animated: true });
    const meta = await probe.metadata();
    const sourceMime = normalizeMime(meta.format, res.contentType);
    const animated = (meta.pages ?? 1) > 1;
    const isSvg = sourceMime.includes('svg');

    // 图标/头像/角标一律跳过：比这还小的东西不会是正文配图
    const w0 = meta.width ?? 0;
    const h0 = meta.height ?? 0;
    if (!animated && w0 > 0 && h0 > 0 && w0 < MIN_EDGE && h0 < MIN_EDGE) {
      console.log(`[assets] 跳过小图 ${w0}×${h0}: ${url.slice(0, 80)}`);
      return null;
    }

    const assetId = randomUUID();
    const bucket = sha256.slice(0, 2);
    const base = join(assetsDir, bucket);

    // 4) 派生两档
    let displayBuf: Buffer;
    let displayMime: string;
    let displayWidth = meta.width;
    let displayHeight = meta.height;

    if (animated || isSvg) {
      // 动图转码会丢帧；SVG 不该栅格化 —— 两者都原样保存
      displayBuf = res.body;
      displayMime = sourceMime;
    } else {
      const out = await sharp(res.body)
        .rotate() // 按 EXIF 方向摆正（同时会剥掉 EXIF，含 GPS）
        .resize({
          width: displayMaxEdge,
          height: displayMaxEdge,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: displayQuality })
        .toBuffer({ resolveWithObject: true });
      displayBuf = out.data;
      displayMime = 'image/webp';
      displayWidth = out.info.width;
      displayHeight = out.info.height;
    }

    const thumbBuf = await sharp(res.body, { animated: false })
      .rotate()
      .resize({ width: 400, height: 400, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 75 })
      .toBuffer({ resolveWithObject: true });

    // 5) 落盘（用 assetId 命名，避免不同条目同图互相覆盖）
    const displayKey = `${bucket}/${assetId}-display.${extFor(displayMime)}`;
    const thumbKey = `${bucket}/${assetId}-thumb.webp`;

    await mkdir(base, { recursive: true });
    await writeFile(join(assetsDir, displayKey), displayBuf);
    await writeFile(join(assetsDir, thumbKey), thumbBuf.data);

    // 6) 写库
    await db.insert(asset).values({
      id: assetId,
      itemId,
      kind: 'image',
      sha256,
      sourceMime,
      sourceWidth: meta.width,
      sourceHeight: meta.height,
      sourceBytes: res.bytes,
      mime: displayMime,
      width: displayWidth,
      height: displayHeight,
      bytes: displayBuf.byteLength,
      animated,
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
        bytes: thumbBuf.data.byteLength,
        width: thumbBuf.info.width,
        height: thumbBuf.info.height,
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
