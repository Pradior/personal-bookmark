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

/**
 * 正文容器候选，按「命中率 × 精度」排序。
 *
 * 这些选择器来自实际站点，不是猜的：
 *   知乎       .Post-RichText / .RichText / .AnswerItem
 *   cnbeta     .article-content / #news_content
 *   GitHub     article.markdown-body
 *   掘金/简书  .markdown-body / .article
 *   通用        article / main / [role=main]
 */
const CONTENT_SELECTORS = [
  'article',
  'main',
  '[role="main"]',
  '.Post-RichText',
  '.RichText',
  '.AnswerItem',
  '.markdown-body',
  '.article-content',
  '#news_content',
  '.article-body',
  '.post-content',
  '.entry-content',
  '.article',
  '#artibody',
  '#js_content',
  '.content',
  '#content',
];

/** 作者候选：meta 拿不到时兜底 */
const AUTHOR_SELECTORS = [
  '.author',
  '.byline',
  '[rel="author"]',
  '.PostAuthor-info',
  '.article-author',
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
        cookie: ctx.cookie,
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

    const title =
      metaContent($, 'meta[property="og:title"]') ??
      ($('h1').first().text().trim() || $('title').first().text().trim() || undefined);

    const author =
      metaContent($, 'meta[name="author"]') ??
      metaContent($, 'meta[property="article:author"]') ??
      firstText($, AUTHOR_SELECTORS);

    const siteName =
      metaContent($, 'meta[property="og:site_name"]') ?? ctx.url.hostname;

    const excerpt =
      metaContent($, 'meta[property="og:description"]') ??
      metaContent($, 'meta[name="description"]');

    const publishedRaw =
      metaContent($, 'meta[property="article:published_time"]') ??
      metaContent($, 'meta[name="pubdate"]');
    const publishedAt = publishedRaw ? new Date(publishedRaw) : undefined;

    const $root = pickContentRoot($);

    /**
     * 没有正文容器时，可能本来就是个**图集**（截图墙、图片消息、相册页）。
     * 这类页面没有可读文字，但内容就是图片本身，判失败会丢失内容。
     * 门槛 ≥3 张：只有 1–2 张的大多是 logo / 头图，存下来是噪音。
     */
    if (!$root || $root.text().trim().length < 20) {
      const { images } = harvestImages($, $('body'), {
        referer: finalUrl,
        cookie: ctx.cookie,
      });

      if (images.length >= 3) {
        const bodyHtml = ($('body').html() ?? '').trim();
        return {
          type: 'image',
          source: 'web',
          title,
          author,
          siteName,
          excerpt,
          contentHtml: bodyHtml,
          contentText: normalizeText($('body').text()) || (title ?? ''),
          publishedAt:
            publishedAt && !Number.isNaN(publishedAt.getTime()) ? publishedAt : undefined,
          coverUrl: images[0]?.url,
          coverReferer: finalUrl,
          images,
          rawSnapshot: html,
          meta: { finalUrl, imageCount: images.length, kind: 'gallery' },
          warnings: [`没有正文容器，按图集录入，共 ${images.length} 张图`],
        };
      }

      // 连正文都抽不出来：留一条"仅链接"，别整体失败（SPEC §6.2 底线）
      // 打一行诊断：知乎这类站点失败时，光看"解析不出正文"没法判断是
      // 登录墙、验证页，还是选择器没覆盖
      console.warn(
        `[generic] 抽不出正文：内容容器=${$root ? '有' : '无'}，` +
          `可见文字=${normalizeText($root?.text() ?? '').length} 字，` +
          `图片=${images.length} 张，html=${html.length}B`,
      );
      return null;
    }

    const { images } = harvestImages($, $root, { referer: finalUrl, cookie: ctx.cookie });
    const contentHtml = ($root.html() ?? '').trim();
    const contentText = normalizeText($root.text());

    // 质量门槛：太短的大概率不是正文，而是登录墙 / 验证页 / 导航条。
    // 宁可返回 null 让上层记成"仅保存了链接"，也不要存一张空卡片。
    const hasTitle = Boolean(title);
    const tooShort = hasTitle ? contentText.length < 60 : contentText.length < 150;

    /**
     * 图片为主的页面（图片消息、图集、截图墙）：文字必然少，
     * 但内容其实是图片本身。这类不该判成失败，存成 image 条目更合理。
     *
     * 门槛定在 ≥2 张图：只要 1 张的大多是 logo / 头图，存下来是噪音。
     */
    if (tooShort && images.length >= 2) {
      return {
        type: 'image',
        source: 'web',
        title,
        author,
        siteName,
        excerpt,
        contentHtml,
        contentText: contentText || (title ?? ''),
        publishedAt: publishedAt && !Number.isNaN(publishedAt.getTime()) ? publishedAt : undefined,
        coverUrl: images[0]?.url,
        coverReferer: finalUrl,
        images,
        rawSnapshot: html,
        meta: { finalUrl, imageCount: images.length, kind: 'image-dominant' },
        warnings: [`正文文字很少（${contentText.length} 字），按图片条目录入，共 ${images.length} 张图`],
      };
    }

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
  // 命中了明确的内容选择器，门槛就可以低一些 —— 这些选择器本身就是强信号，
  // 要求 200 字会把"短文章"漏掉（知乎回答、GitHub README 摘要都可能很短）。
  for (const selector of CONTENT_SELECTORS) {
    const $el = $(selector).first();
    if ($el.length > 0 && $el.text().trim().length > 80) return $el;
  }

  // 靠启发式（段落最多）时门槛保持高：没有强信号，必须够长才敢认
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

/** 取第一个非空文本（作者之类的小字段用） */
function firstText($: cheerio.CheerioAPI, selectors: string[]): string | undefined {
  for (const selector of selectors) {
    const text = $(selector).first().text().trim();
    if (text.length > 0 && text.length < 80) return text;
  }
  return undefined;
}
