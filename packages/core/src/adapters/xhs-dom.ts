/**
 * 小红书：从**渲染后的 DOM** 里抽正文（扩展路径专用）。
 *
 * 为什么要有这条：小红书的笔记内容由带签名的 API 加载，服务端拿到的
 * HTML 只有空壳（没有 __INITIAL_STATE__、没有 og:image）。
 * 但浏览器扩展送来的是**已经渲染完**的 DOM，此时标题、正文、图片都在元素里。
 *
 * 选择器会随版本变，所以每项都给多个候选，取第一个非空的。
 */
import type * as cheerio from 'cheerio';
import type { CaptureImage } from './types';
import { normalizeText } from './shared';

const TITLE_SELECTORS = [
  '#detail-title',
  '.note-content .title',
  '.note-detail-title',
  'h1.title',
];

const DESC_SELECTORS = [
  '#detail-desc',
  '.note-content .desc',
  '.note-text',
  '.note-desc',
  '.desc',
];

const IMAGE_SELECTORS = [
  '.swiper-slide img',
  '.note-slider img',
  '.slider-container img',
  '.img-container img',
  'img[src*="xhscdn.com"]',
];

const AUTHOR_SELECTORS = ['.author-wrapper .name', '.author .name', '.user-nickname'];

function firstText($: cheerio.CheerioAPI, selectors: string[]): string | undefined {
  for (const selector of selectors) {
    const text = $(selector).first().text().trim();
    if (text.length > 0) return text;
  }
  return undefined;
}

const MIN_ATTR_EDGE = 120;

/** 站点自己的静态资源（图标、logo）不能当配图 */
function isSiteAsset(url: string): boolean {
  if (/^https?:\/\/fe-static\./i.test(url)) return true;
  if (url.includes('/resource/')) return true;
  if (/\.svg$/i.test(url.split(/[?!]/, 1)[0] ?? url)) return true;
  return false;
}

function collectImages($: cheerio.CheerioAPI, limit = 24): { url: string; alt?: string }[] {
  const seen = new Set<string>();
  const out: { url: string; alt?: string }[] = [];

  for (const selector of IMAGE_SELECTORS) {
    // 用 toArray + for 而不是 $(sel).each：cheerio 的 each 回调返回 false 会中断循环，
    // 之前写成 `return out.length >= limit` 结果只收到第一张。
    const nodes = $(selector).toArray();

    for (const node of nodes) {
      const el = node as unknown as { attribs?: Record<string, string> };
      const raw = el.attribs?.src ?? el.attribs?.['data-src'];
      if (!raw) continue;

      const url = raw.trim();
      if (!/^https?:\/\//i.test(url)) continue;
      if (!url.includes('xhscdn.com')) continue; // 站外图不要
      if (isSiteAsset(url)) continue; // 图标/logo 不要
      if (seen.has(url)) continue;

      // 元素上标了尺寸且很小 → 图标，跳过
      const w = Number(el.attribs?.width ?? '0');
      const h = Number(el.attribs?.height ?? '0');
      if (w > 0 && h > 0 && w < MIN_ATTR_EDGE && h < MIN_ATTR_EDGE) continue;

      seen.add(url);
      out.push({ url, alt: el.attribs?.alt });
      if (out.length >= limit) break;
    }

    if (out.length > 0) break; // 命中一个选择器就够，别把评论区的图也扫进来
  }

  return out.slice(0, limit);
}

export type DomExtract = {
  title?: string;
  desc?: string;
  author?: string;
  images: CaptureImage[];
  contentHtml: string;
  contentText: string;
};

export function extractFromDom(
  $: cheerio.CheerioAPI,
  options: {
    cookie?: string;
    userAgent: string;
    referer: string;
    /** DOM 里没标题/正文时的兜底（来自 og:*），避免"只有图没有字"的条目被丢 */
    fallbackTitle?: string;
    fallbackDesc?: string;
  },
): DomExtract | null {
  const domTitle = firstText($, TITLE_SELECTORS);
  const domDesc = firstText($, DESC_SELECTORS);
  const author = firstText($, AUTHOR_SELECTORS);
  const found = collectImages($);

  /**
   * 判定"是不是渲染后的详情页"，只能看 DOM 里有没有真东西。
   * 不能把 og:title 之类当证据 —— og:image 是 <meta> 不是 <img>，
   * 那样会把"只有 meta 的服务端外壳页"误判成 DOM 命中。
   */
  const hasDomEvidence = Boolean(domTitle) || Boolean(domDesc) || found.length > 0;
  if (!hasDomEvidence) return null;

  // 有 DOM 证据之后，缺的字段才用 og:* 补
  const title = domTitle ?? options.fallbackTitle;
  const desc = domDesc ?? options.fallbackDesc;

  const text = normalizeText(`${title ?? ''}\n${desc ?? ''}`);

  const images: CaptureImage[] = [];
  const parts: string[] = [];

  if (title) parts.push(`<h1>${escapeHtml(title)}</h1>`);
  if (desc) {
    for (const line of desc.split(/\n+/)) {
      const t = line.trim();
      if (t) parts.push(`<p>${escapeHtml(t)}</p>`);
    }
  }

  found.forEach((img, i) => {
    const key = `img-${i + 1}`;
    images.push({
      key,
      url: img.url,
      referer: options.referer,
      userAgent: options.userAgent,
      cookie: options.cookie,
    });
    parts.push(`<p><img data-pb-img="${key}" /></p>`);
  });

  return {
    title,
    desc,
    author,
    images,
    contentHtml: parts.join('\n'),
    contentText: text,
  };
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
