/**
 * 通用网页兜底 adapter（SPEC §6.3，priority = 0）
 *
 * Sprint 1 只用 cheerio 做启发式抽取，不引 jsdom + Readability：
 * 那套要多装 ~20MB 依赖，而本阶段 90% 的真实场景是公众号。
 * 正文定位顺序：语义标签 → 常见内容容器 → 段落文本最长的容器。
 */
import * as cheerio from 'cheerio';
import { detectBlock, fetchHtml, FetchError, DESKTOP_UA } from '../fetcher';
import type { Adapter, CaptureContext, CaptureResult } from './types';
import { countWords } from './types';
import { harvestImages, metaContent, normalizeText } from './shared';

const CONTENT_SELECTORS = [
  'article',
  'main',
  '[role="main"]',
  '.article-content',
  '.post-content',
  '.entry-content',
  '#js_content',
  '.content',
  '#content',
];

export const genericAdapter: Adapter = {
  id: 'generic',
  priority: 0,

  match(): boolean {
    return true;
  },

  async capture(ctx: CaptureContext): Promise<CaptureResult | null> {
    let html = ctx.html;
    let finalUrl = ctx.url.toString();

    if (!html) {
      const res = await fetchHtml(ctx.url.toString(), {
        userAgent: ctx.userAgent ?? DESKTOP_UA,
        timeoutMs: ctx.timeoutMs,
        maxBytes: ctx.maxBytes,
      });
      html = res.html;
      finalUrl = res.finalUrl;

      const blocked = detectBlock(res.html, res.finalUrl);
      if (blocked) {
        throw new FetchError(`${blocked}。请在浏览器里打开后手动保存。`, 'blocked', res.status);
      }
    }

    const $ = cheerio.load(html);

    $('script, style, noscript, iframe').remove();

    const $root = pickContentRoot($);
    if (!$root || $root.text().trim().length < 20) {
      // 连正文都抽不出来：留一条"仅链接"，别整体失败（SPEC §6.2 底线）
      return null;
    }

    const title =
      metaContent($, 'meta[property="og:title"]') ??
      ($('h1').first().text().trim() || $('title').first().text().trim() || undefined);

    const author =
      metaContent($, 'meta[name="author"]') ??
      metaContent($, 'meta[property="article:author"]');

    const siteName =
      metaContent($, 'meta[property="og:site_name"]') ?? ctx.url.hostname;

    const excerpt =
      metaContent($, 'meta[property="og:description"]') ??
      metaContent($, 'meta[name="description"]');

    const publishedRaw =
      metaContent($, 'meta[property="article:published_time"]') ??
      metaContent($, 'meta[name="pubdate"]');
    const publishedAt = publishedRaw ? new Date(publishedRaw) : undefined;

    const { images } = harvestImages($, $root, { referer: finalUrl });
    const contentHtml = ($root.html() ?? '').trim();
    const contentText = normalizeText($root.text());

    // 质量门槛：太短的大概率不是正文，而是登录墙 / 验证页 / 导航条。
    // 宁可返回 null 让上层记成"仅保存了链接"，也不要存一张空卡片。
    const hasTitle = Boolean(title);
    const tooShort = hasTitle ? contentText.length < 60 : contentText.length < 150;
    if (tooShort) {
      return null;
    }

    return {
      type: 'article',
      source: 'web',
      title,
      author,
      siteName,
      excerpt,
      contentHtml,
      contentText,
      publishedAt: publishedAt && !Number.isNaN(publishedAt.getTime()) ? publishedAt : undefined,
      coverUrl: metaContent($, 'meta[property="og:image"]'),
      coverReferer: finalUrl,
      images,
      rawSnapshot: html,
      meta: { finalUrl, imageCount: images.length },
      warnings: [],
    };
  },
};

/** 找不到语义容器时，挑段落总字数最多的那个 div */
function pickContentRoot($: cheerio.CheerioAPI): cheerio.Cheerio<any> | null {
  for (const selector of CONTENT_SELECTORS) {
    const $el = $(selector).first();
    if ($el.length > 0 && $el.text().trim().length > 200) return $el;
  }

  let best: cheerio.Cheerio<any> | null = null;
  let bestScore = 0;

  $('div, section').each((_, node) => {
    const $node = $(node);
    const paragraphs = $node.find('p');
    if (paragraphs.length < 3) return;
    const score = paragraphs.text().trim().length;
    if (score > bestScore) {
      bestScore = score;
      best = $node;
    }
  });

  return bestScore > 200 ? best : null;
}
