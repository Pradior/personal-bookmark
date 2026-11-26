/**
 * capture 任务（SPEC T1.3–T1.6 的编排）
 *
 * 流程：选 adapter → 下载图片 → 清洗 → 写库。
 * 原则：单张图失败不拖跨整篇；整篇解析失败也要留住条目（SPEC §6.2 底线）。
 */
import { gzipSync } from 'node:zlib';
import { eq } from 'drizzle-orm';
import { item, snapshot, type Database } from '@pb/db';
import {
  applyHints,
  captureWithFallback,
  FetchError,
  htmlToText,
  sanitizeContent,
  type CaptureHints,
  type ImageMap,
} from '@pb/core';
import { ingestImage } from '../assets';
import { findCredential, type SiteCredential } from '../credentials';

export type CaptureJobData = {
  itemId: string;
};

export type CaptureEnv = {
  db: Database;
  assetsDir: string;
  /** 用于解密站点凭据 */
  authSecret: string;
  maxAssetBytes: number;
  displayMaxEdge: number;
  displayQuality: number;
};

export async function runCapture(data: CaptureJobData, env: CaptureEnv): Promise<void> {
  const { db } = env;
  const itemId = data.itemId;

  const rows = await db.select().from(item).where(eq(item.id, itemId)).limit(1);
  const row = rows[0];
  if (!row) {
    console.warn(`[capture] 条目不存在: ${itemId}`);
    return;
  }

  const url = row.url;
  console.log(`[capture] 开始处理 ${itemId} ${url.slice(0, 90)}`);

  const setState = async (
    patch: Partial<typeof item.$inferInsert>,
  ): Promise<void> => {
    await db.update(item).set(patch).where(eq(item.id, itemId));
  };

  try {
    await setState({ fetchState: 'fetching', fetchError: null });

    // 客户端（扩展 / 粘贴正文）送来的 HTML 优先 —— 这是绕开反爬的正路
    const meta = (row.meta ?? {}) as Record<string, unknown>;
    const clientHtml = typeof meta.clientHtml === 'string' ? meta.clientHtml : undefined;

    // 站点凭据（Cookie）：未登录只给空壳的站点靠它拿内容
    const credential: SiteCredential | null = await findCredential(
      db,
      new URL(url).hostname,
      env.authSecret,
    ).catch(() => null);

    if (credential) {
      console.log(`[capture] 使用站点凭据: ${credential.domain}`);
    }

    const { result: baseResult, tried } = await captureWithFallback({
      url: new URL(url),
      html: clientHtml,
      cookie: credential?.cookie,
      userAgent: credential?.userAgent,
      referer: credential?.referer,
    });

    if (!baseResult) {
      await setState({
        fetchState: 'failed',
        fetchError: `解析不出正文（adapter: ${tried.join(' → ')}）。可以试试用浏览器打开后粘贴正文保存。`,
        fetchedAt: new Date(),
      });
      return;
    }

    // 把扩展在页面里按渲染尺寸筛出来的图片并进来。
    // 小红书的配图是懒加载的，服务端 HTML 里没有；扩展抓 DOM 时也可能没滚到底。
    const hint = (meta.hint ?? undefined) as CaptureHints | undefined;
    const result = applyHints(baseResult, hint, {
      referer: credential?.referer,
      userAgent: credential?.userAgent,
      cookie: credential?.cookie,
    });
    if (hint?.images?.length) {
      console.log(
        `[capture] 客户端提示图片 ${hint.images.length} 张，合并后共 ${result.images.length} 张`,
      );
    }

    // ── 图片 ────────────────────────────────────────────
    await setState({ fetchState: 'assets' });

    const imageMap: ImageMap = {};
    const ingested = new Map<string, string>(); // key → assetId

    await mapLimit(result.images, 3, async (img) => {
      const out = await ingestImage(db, {
        url: img.url,
        referer: img.referer,
        userAgent: img.userAgent,
        cookie: img.cookie,
        itemId,
        assetsDir: env.assetsDir,
        maxBytes: env.maxAssetBytes,
        displayMaxEdge: env.displayMaxEdge,
        displayQuality: env.displayQuality,
      });
      if (!out) return;
      ingested.set(img.key, out.assetId);
      imageMap[img.key] = {
        assetId: out.assetId,
        width: out.width,
        height: out.height,
        sourceAvailable: out.sourceAvailable,
      };
    });

    const okCount = ingested.size;
    if (okCount < result.images.length) {
      result.warnings.push(
        `${result.images.length - okCount} 张图片下载失败，正文中已移除`,
      );
    }

    // ── 清洗 ────────────────────────────────────────────
    const contentHtml = sanitizeContent(result.contentHtml, imageMap);
    const contentText = htmlToText(contentHtml) || result.contentText;

    // 封面：优先用文章自己声明的，否则退到第一张成功下载的图
    let coverAssetId: string | undefined;
    if (result.coverUrl) {
      const match = result.images.find((i) => i.url === result.coverUrl);
      if (match) coverAssetId = ingested.get(match.key);
    }
    if (!coverAssetId) {
      coverAssetId = result.images
        .map((i) => ingested.get(i.key))
        .find((id): id is string => Boolean(id));
    }

    // ── 落库 ────────────────────────────────────────────
    await setState({
      type: result.type,
      source: result.source,
      title: result.title ?? null,
      author: result.author ?? null,
      siteName: result.siteName ?? null,
      excerpt: result.excerpt ?? null,
      publishedAt: result.publishedAt ?? null,
      contentHtml,
      contentText,
      wordCount: countWords(contentText),
      coverAssetId: coverAssetId ?? null,
      adapterId: tried[0] ?? null,
      fetchState: 'done',
      fetchError: result.warnings.length > 0 ? result.warnings.join('; ') : null,
      fetchedAt: new Date(),
      updatedAt: new Date(),
      meta: {
        ...meta,
        clientHtml: undefined,
        imageCount: result.images.length,
        imagesStored: okCount,
        warnings: result.warnings,
        finalUrl: result.meta.finalUrl,
      },
    });

    if (result.rawSnapshot) {
      const gz = gzipSync(Buffer.from(result.rawSnapshot, 'utf8'));
      await db.insert(snapshot).values({
        itemId,
        rawGz: gz.toString('base64'),
        bytes: result.rawSnapshot.length,
      });
    }

    console.log(
      `[capture] 完成 ${itemId}：${contentText.length} 字 / ${okCount} 张图 / adapter=${tried[0]}`,
    );
  } catch (err) {
    const message =
      err instanceof FetchError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);

    console.error(`[capture] 失败 ${itemId}: ${message}`);
    await setState({
      fetchState: 'failed',
      fetchError: message.slice(0, 500),
      fetchedAt: new Date(),
      updatedAt: new Date(),
    }).catch((e: unknown) => console.error('[capture] 写失败状态也失败了', e));
  }
}

/** 中文按字、英文按词 */
function countWords(text: string): number {
  const cjk = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z0-9]+/g) ?? []).length;
  return cjk + latin;
}

/** 限制并发，别让 N100 同时开十几个 sharp */
async function mapLimit<T>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length || 1) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      await fn(items[index] as T, index);
    }
  });
  await Promise.all(workers);
}
