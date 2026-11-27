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
import { browserEnabled, preferBrowser, renderWithBrowser } from '../browser';

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

  // 速记没有来源链接，不会进抓取队列；真进来了就是数据不一致
  const url = row.url;
  if (!url) {
    console.warn(`[capture] 条目没有来源链接，跳过: ${itemId}`);
    await db
      .update(item)
      .set({ fetchState: 'failed', fetchError: '该条目没有来源链接，无法抓取' })
      .where(eq(item.id, itemId));
    return;
  }

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

    /**
     * 已知必须跑 JS 的站点（小红书 / 抖音 / 知乎 / 海外社交）：
     * 直接走浏览器，跳过那次注定失败的请求。
     *
     * 客户端送来 HTML（扩展 / 粘贴正文）时不用浏览器 —— 那已经是最好的输入。
     */
    let renderedHtml = clientHtml;
    let viaBrowser = false;

    if (!renderedHtml && preferBrowser(url)) {
      console.log(`[capture] 该站点需要 JS 渲染，直接走无头浏览器 ${url.slice(0, 80)}`);
      const rendered = await renderWithBrowser(url, {
        cookie: credential?.cookie,
        userAgent: credential?.userAgent,
      });
      if (rendered) {
        renderedHtml = rendered.html;
        viaBrowser = true;
      } else {
        // 浏览器不可用时退回普通抓取，至少还能存下标题和摘要
        console.warn('[capture] 浏览器渲染不可用，退回普通抓取');
      }
    }

    const { result: baseResult, tried } = await captureWithFallback({
      url: new URL(url),
      html: renderedHtml,
      cookie: credential?.cookie,
      userAgent: credential?.userAgent,
      referer: credential?.referer,
    });

    /**
     * 还没用浏览器、且普通抓取失败时，再试一次浏览器。
     *
     * 为什么不在之前：渲染一次 2–5 秒，而大多数站点（公众号图文、
     * 普通网页）直接 fetch 就够了。只有"抓不到内容"时才值得付这个代价。
     *
     * 没配 BROWSER_URL（没起浏览器容器）时这里直接跳过，行为与以前一致。
     */
    let result = baseResult;

    if (!result && !viaBrowser && browserEnabled()) {
      console.log(`[capture] 普通抓取失败，改用无头浏览器渲染 ${url.slice(0, 80)}`);
      const rendered = await renderWithBrowser(url, {
        cookie: credential?.cookie,
        userAgent: credential?.userAgent,
      });

      if (rendered) {
        const retry = await captureWithFallback({
          url: new URL(rendered.finalUrl || url),
          html: rendered.html,
          cookie: credential?.cookie,
          userAgent: credential?.userAgent,
          referer: credential?.referer,
        });
        if (retry.result) {
          result = retry.result;
          viaBrowser = true;
          console.log(
            `[capture] 浏览器渲染后解析成功：${rendered.html.length}B → ` +
              `${retry.result.images.length} 张图`,
          );
        } else {
          console.warn(
            `[capture] 浏览器渲染了，但 ${retry.tried.join(' → ')} 仍抽不出正文`,
          );
        }
      }
    }

    if (!result) {
      // 这条必须打：否则日志里只有"开始处理"，看不出到底哪一步失败
      console.warn(
        `[capture] 解析失败 ${itemId}：${tried.join(' → ')} 都没能抽出正文` +
          `${clientHtml ? `（客户端 HTML ${Math.round(clientHtml.length / 1024)}KB）` : '（服务端抓取）'}`,
      );
      const browserHint = browserEnabled()
        ? '已尝试无头浏览器渲染仍失败'
        : '这类页面需要前端渲染，可以启用浏览器容器或改用扩展保存';
      await setState({
        fetchState: 'failed',
        fetchError: `解析不出正文（adapter: ${tried.join(' → ')}）。${browserHint}。`,
        fetchedAt: new Date(),
      });
      return;
    }

    // 把扩展在页面里按渲染尺寸筛出来的图片并进来。
    // 小红书的配图是懒加载的，服务端 HTML 里没有；扩展抓 DOM 时也可能没滚到底。
    const hint = (meta.hint ?? undefined) as CaptureHints | undefined;
    result = applyHints(result, hint, {
      referer: credential?.referer,
      userAgent: credential?.userAgent,
      cookie: credential?.cookie,
    });
    if (viaBrowser) {
      result.warnings.push('正文由无头浏览器渲染后解析');
    }
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
