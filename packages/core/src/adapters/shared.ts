/** 各 adapter 共用的小工具 */
import type * as cheerio from 'cheerio';
import { decodeEntities } from '../fetcher';
import type { CaptureImage } from './types';

/** 正文图片真地址的优先级（顺序不能错，见 SPEC §6.3） */
const IMG_ATTRS = ['data-src', 'data-original', 'data-lazy-src', 'data-backsrc', 'src'] as const;

type AnyEl = { attribs?: Record<string, string> };

export function pickImageUrl(node: unknown): string | undefined {
  const attrs = (node as AnyEl | undefined)?.attribs ?? {};
  for (const attr of IMG_ATTRS) {
    const raw = attrs[attr];
    if (!raw) continue;
    const url = decodeEntities(raw).trim();
    if (!url) continue;
    if (url.startsWith('data:')) continue; // 占位图，不是真图
    if (!/^https?:\/\//i.test(url)) continue;
    return url;
  }
  return undefined;
}

export type HarvestOptions = {
  referer?: string;
  userAgent?: string;
};

/**
 * 把容器里的 <img> 换成 data-pb-img 占位符，并返回下载清单。
 * 取不到真地址的图直接删掉（留着只会是裂图）。
 */
export function harvestImages(
  $: cheerio.CheerioAPI,
  $root: cheerio.Cheerio<any>,
  options: HarvestOptions = {},
): { images: CaptureImage[]; count: number } {
  const images: CaptureImage[] = [];
  let index = 0;

  $root.find('img').each((_, node) => {
    index += 1;
    const url = pickImageUrl(node);
    const $n = $(node);

    if (!url) {
      $n.remove();
      return;
    }

    const key = `img-${index}`;
    images.push({ key, url, referer: options.referer, userAgent: options.userAgent });

    const attrs = (node as AnyEl).attribs ?? {};
    const width = attrs['data-w'] ?? attrs.width;
    const height = attrs['data-h'] ?? attrs.height;

    // 清掉所有属性，只留占位符与尺寸 —— 渲染层只认本地资源（ADR-002）
    for (const attr of Object.keys(attrs)) $n.removeAttr(attr);
    $n.attr('data-pb-img', key);
    if (width) $n.attr('width', width);
    if (height) $n.attr('height', height);
  });

  return { images, count: images.length };
}

export function normalizeText(input: string): string {
  return input
    .replace(/\u200b/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 取 meta 内容的小助手 */
export function metaContent($: cheerio.CheerioAPI, selector: string): string | undefined {
  const v = $(selector).attr('content')?.trim();
  return v && v.length > 0 ? v : undefined;
}
