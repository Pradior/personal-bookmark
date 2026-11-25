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

/**
 * 从 marker 之后找第一个配平的 JSON 对象。
 * 字符串里的花括号不算数，所以不能用正则一把梭。
 */
export function extractJsonObject(html: string, marker: string): string | null {
  const markerIdx = html.indexOf(marker);
  if (markerIdx < 0) return null;

  const start = html.indexOf('{', markerIdx);
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let quote = '';
  let escaped = false;

  for (let i = start; i < html.length; i += 1) {
    const ch = html.charAt(i);

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === quote) inString = false;
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = true;
      quote = ch;
      continue;
    }
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return html.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * 深度遍历 JSON 找第一个满足条件的对象。
 * 抖音/小红书的 state 层级随版本变化，写死路径非常脆，按特征找更稳。
 */
export function deepFind(
  root: unknown,
  predicate: (node: Record<string, unknown>) => boolean,
  maxDepth = 14,
): Record<string, unknown> | null {
  const queue: Array<{ node: unknown; depth: number }> = [{ node: root, depth: 0 }];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    const { node, depth } = current;
    if (depth > maxDepth || node === null || typeof node !== 'object') continue;

    if (Array.isArray(node)) {
      for (const item of node) queue.push({ node: item, depth: depth + 1 });
      continue;
    }

    const record = node as Record<string, unknown>;
    try {
      if (predicate(record)) return record;
    } catch {
      /* predicate 抛错就当不匹配 */
    }

    for (const value of Object.values(record)) {
      if (value && typeof value === 'object') {
        queue.push({ node: value, depth: depth + 1 });
      }
    }
  }

  return null;
}

/** 把抖音常见的 `//p3-sign.douyinpic.com/...` 补成完整 URL */
export function ensureProtocol(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const trimmed = url.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  if (!/^https?:\/\//i.test(trimmed)) return undefined;
  return trimmed;
}

