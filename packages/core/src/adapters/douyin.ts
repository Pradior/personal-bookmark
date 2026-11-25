/**
 * 抖音 adapter（SPEC §6.3）
 *
 * 只归档元信息：标题（文案）、作者、封面、时长、原链接。
 * **不下载视频本体** —— 体积大、直链带签名且很快失效，存下来也打不开。
 *
 * 抖音的页面数据在两种位置，随版本切换：
 *   - 新：window._ROUTER_DATA（loaderData 里嵌套很深的 item_list）
 *   - 旧：<script id="RENDER_DATA"> 里 URI 编码的 JSON
 * 层级会变，所以不写死路径，按特征深搜（desc + video/aweme_id）。
 */
import * as cheerio from 'cheerio';
import { detectBlock, fetchHtml, FetchError, DESKTOP_UA } from '../fetcher';
import type { Adapter, CaptureContext, CaptureImage, CaptureResult } from './types';
import {
  deepFind,
  ensureProtocol,
  extractJsonObject,
  metaContent,
  normalizeText,
} from './shared';

const DOUYIN_REFERER = 'https://www.douyin.com/';

type VideoNode = {
  cover?: { url_list?: string[] };
  cover_original_scale?: { url_list?: string[] };
  duration?: number;
};

type AwemeNode = {
  desc?: string;
  create_time?: number;
  author?: { nickname?: string; unique_id?: string };
  video?: VideoNode;
};

/** 从 video 节点里挑一个封面地址 */
function pickCover(video: VideoNode | undefined): string | undefined {
  const lists = [video?.cover_original_scale?.url_list, video?.cover?.url_list];
  for (const list of lists) {
    for (const raw of list ?? []) {
      const url = ensureProtocol(raw);
      if (url) return url;
    }
  }
  return undefined;
}

/** 把「一行行文案」转成段落 */
function toParagraphs(text: string): string {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join('\n');
}

export const douyinAdapter: Adapter = {
  id: 'douyin',
  priority: 80,

  match(url: URL): boolean {
    const host = url.hostname.toLowerCase();
    return (
      host === 'douyin.com' ||
      host.endsWith('.douyin.com') ||
      host.endsWith('iesdouyin.com')
    );
  },

  async capture(ctx: CaptureContext): Promise<CaptureResult | null> {
    let html = ctx.html;
    let finalUrl = ctx.url.toString();

    if (!html) {
      const res = await fetchHtml(ctx.url.toString(), {
        userAgent: ctx.userAgent ?? DESKTOP_UA,
        cookie: ctx.cookie,
        referer: DOUYIN_REFERER,
        timeoutMs: ctx.timeoutMs,
        maxBytes: ctx.maxBytes,
      });
      html = res.html;
      finalUrl = res.finalUrl;

      const blocked = detectBlock(res.html, res.finalUrl);
      if (blocked) {
        throw new FetchError(
          `${blocked}。抖音链接请在浏览器里打开后用扩展保存。`,
          'blocked',
          res.status,
        );
      }
    }

    const warnings: string[] = ['视频本体未归档（只保存了封面、文案与原链接）'];
    const $ = cheerio.load(html);

    // ── 1) 新结构：window._ROUTER_DATA ──────────────────
    let aweme: AwemeNode | null = null;

    const routerRaw = extractJsonObject(html, 'window._ROUTER_DATA');
    if (routerRaw) {
      try {
        const state = JSON.parse(routerRaw.replace(/([:,[]\s*)undefined\b/g, '$1null'));
        aweme = deepFind(state, (node) => {
          const hasDesc = typeof node.desc === 'string';
          const hasVideo = typeof node.video === 'object' && node.video !== null;
          const hasId = typeof node.aweme_id === 'string' || typeof node.awemeId === 'string';
          return hasDesc && (hasVideo || hasId);
        }) as AwemeNode | null;
      } catch {
        warnings.push('_ROUTER_DATA 解析失败，尝试 RENDER_DATA');
      }
    }

    // ── 2) 旧结构：script#RENDER_DATA（URI 编码）────────
    if (!aweme) {
      const renderRaw = $('#RENDER_DATA').text().trim();
      if (renderRaw) {
        try {
          const decoded = decodeURIComponent(renderRaw);
          const state = JSON.parse(decoded.replace(/([:,[]\s*)undefined\b/g, '$1null'));
          aweme = deepFind(state, (node) => {
            const hasDesc = typeof node.desc === 'string';
            const hasVideo = typeof node.video === 'object' && node.video !== null;
            return hasDesc && hasVideo;
          }) as AwemeNode | null;
        } catch {
          warnings.push('RENDER_DATA 解析失败，退回 meta 兜底');
        }
      }
    }

    // ── 3) 有结构化数据：自己拼正文 ─────────────────────
    if (aweme) {
      const desc = (aweme.desc ?? '').trim();
      const author = aweme.author?.nickname?.trim() || undefined;
      const coverUrl = pickCover(aweme.video);
      const durationSec =
        typeof aweme.video?.duration === 'number'
          ? Math.round(aweme.video.duration / 1000)
          : undefined;

      const images: CaptureImage[] = [];
      const parts: string[] = [];

      if (desc) {
        const firstLine = desc.split(/\n/)[0]?.trim() ?? '';
        if (firstLine) parts.push(`<h1>${escapeHtml(firstLine.slice(0, 120))}</h1>`);
        parts.push(toParagraphs(desc));
      }

      if (coverUrl) {
        images.push({
          key: 'img-1',
          url: coverUrl,
          referer: DOUYIN_REFERER,
          userAgent: DESKTOP_UA,
          cookie: ctx.cookie,
        });
        parts.push('<p><img data-pb-img="img-1" /></p>');
      }

      parts.push(
        `<p><a href="${escapeHtml(finalUrl)}">在原站打开这条视频</a></p>`,
      );

      const contentText = normalizeText(desc);
      if (contentText.length < 5 && images.length === 0) return null;

      return {
        type: 'video',
        source: 'douyin',
        title: desc ? desc.split(/\n/)[0]?.slice(0, 120) : undefined,
        author,
        siteName: '抖音',
        excerpt: contentText.slice(0, 120) || undefined,
        contentHtml: parts.join('\n'),
        contentText,
        publishedAt: aweme.create_time ? new Date(aweme.create_time * 1000) : undefined,
        coverUrl,
        coverReferer: DOUYIN_REFERER,
        images,
        rawSnapshot: html,
        meta: { finalUrl, imageCount: images.length, durationSec, via: 'router_data' },
        warnings,
      };
    }

    // ── 4) 退回 meta ───────────────────────────────────
    const ogTitle = metaContent($, 'meta[property="og:title"]');
    const ogDesc = metaContent($, 'meta[property="og:description"]');
    const ogImage = ensureProtocol(metaContent($, 'meta[property="og:image"]'));

    if (!ogTitle && !ogDesc && !ogImage) return null;

    warnings.push('只拿到了页面 meta 信息，文案可能不完整');

    const images: CaptureImage[] = [];
    const parts: string[] = [];
    if (ogTitle) parts.push(`<h1>${escapeHtml(ogTitle)}</h1>`);
    if (ogDesc) parts.push(`<p>${escapeHtml(ogDesc)}</p>`);
    if (ogImage) {
      images.push({
        key: 'img-1',
        url: ogImage,
        referer: DOUYIN_REFERER,
        userAgent: DESKTOP_UA,
        cookie: ctx.cookie,
      });
      parts.push('<p><img data-pb-img="img-1" /></p>');
    }
    parts.push(`<p><a href="${escapeHtml(finalUrl)}">在原站打开这条视频</a></p>`);

    const contentText = normalizeText(`${ogTitle ?? ''}\n${ogDesc ?? ''}`);
    if (contentText.length < 5 && images.length === 0) return null;

    return {
      type: 'video',
      source: 'douyin',
      title: ogTitle,
      siteName: '抖音',
      excerpt: ogDesc,
      contentHtml: parts.join('\n'),
      contentText,
      coverUrl: ogImage,
      coverReferer: DOUYIN_REFERER,
      images,
      rawSnapshot: html,
      meta: { finalUrl, imageCount: images.length, via: 'meta' },
      warnings,
    };
  },
};

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export const __internal = { pickCover };
