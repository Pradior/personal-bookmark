/**
 * HTML 清洗（SPEC T1.6）
 *
 * 目标：把 adapter 产出的正文变成"渲染安全 + 只认本地资源"的 HTML。
 *
 * 保留什么：inline `style` 属性（公众号排版全靠它：对齐、间距、颜色）
 * 剥掉什么：<script> <style> <iframe> <object> <embed> <form> 以及 on* 事件属性、
 *          javascript: 链接、data-src/data-original 等懒加载残留
 */
import * as cheerio from 'cheerio';

export type SanitizedImage = {
  assetId: string;
  width?: number;
  height?: number;
  /** 能否「预览原图」（origin_url 是否可用） */
  sourceAvailable: boolean;
};

export type ImageMap = Record<string, SanitizedImage>;

const DROP_TAGS = [
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'form',
  'input',
  'button',
  'textarea',
  'select',
  'link',
  'meta',
  'base',
];

const URL_ATTRS = ['href', 'src', 'action', 'formaction', 'poster', 'background'];

export function sanitizeContent(html: string, images: ImageMap): string {
  const $ = cheerio.load(html, { xml: false }, false);

  for (const tag of DROP_TAGS) $(tag).remove();

  // 事件属性 / javascript: 协议 / 危险 style
  $('*').each((_, node) => {
    const el = node as unknown as { attribs?: Record<string, string>; tagName?: string };
    const attrs = el.attribs;
    if (!attrs) return;

    for (const name of Object.keys(attrs)) {
      const lower = name.toLowerCase();
      if (lower.startsWith('on')) {
        $(node).removeAttr(name);
        continue;
      }
      if (lower === 'style') {
        const css = attrs[name] ?? '';
        // position:fixed、超大 z-index 之类的会跑到正文外面去
        if (/position\s*:\s*(fixed|sticky)/i.test(css) || /z-index\s*:\s*\d{4,}/i.test(css)) {
          $(node).removeAttr(name);
        }
        continue;
      }
      if (URL_ATTRS.includes(lower)) {
        const value = (attrs[name] ?? '').trim().toLowerCase();
        if (value.startsWith('javascript:') || value.startsWith('data:text/html')) {
          $(node).removeAttr(name);
        }
      }
    }

    // 懒加载残留：留着也没用，还可能让人以为原站图片还在
    if (el.tagName === 'img') {
      for (const attr of ['data-src', 'data-original', 'data-lazy-src', 'data-backsrc', 'srcset']) {
        $(node).removeAttr(attr);
      }
    }
  });

  // 图片：占位符 → 本地资源地址
  $('img[data-pb-img]').each((_, node) => {
    const $n = $(node);
    const key = $n.attr('data-pb-img');
    if (!key) return;

    const mapped = images[key];
    if (!mapped) {
      $n.remove();
      return;
    }

    $n.removeAttr('data-pb-img');
    $n.attr('src', `/api/v1/assets/${mapped.assetId}`);
    $n.attr('data-thumb', `/api/v1/assets/${mapped.assetId}/thumb`);
    // 「预览原图」只在源地址可用时才给入口（ADR-013）
    if (mapped.sourceAvailable) {
      $n.attr('data-source', `/api/v1/assets/${mapped.assetId}/source`);
    }
    if (mapped.width) $n.attr('width', String(mapped.width));
    if (mapped.height) $n.attr('height', String(mapped.height));
    $n.attr('loading', 'lazy');
    $n.attr('decoding', 'async');
  });

  // 外链统一加 rel，避免原站通过 window.opener 搞事
  $('a[href]').each((_, node) => {
    $(node).attr('target', '_blank');
    $(node).attr('rel', 'noopener noreferrer nofollow');
  });

  return ($.html() ?? '').trim();
}

/** 从清洗后的 HTML 里掉多余空白，用于存 content_text */
export function htmlToText(html: string): string {
  const $ = cheerio.load(html, { xml: false }, false);
  return $.root()
    .text()
    .replace(/\u200b/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
