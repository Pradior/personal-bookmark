/**
 * 客户端「提示」合并（hints merge）
 *
 * 背景：小红书这类 SPA 的配图是懒加载的，服务端抓到的 HTML 里没有；
 * 扩展抓 DOM 时如果页面没滚到底，图片也可能还没变成 <img>。
 * 但扩展在页面上下文里能读到每张图的 naturalWidth —— 用它按尺寸筛，
 * 比维护一堆 CSS 选择器稳得多。
 *
 * 这里把客户端给的结果当作**补充**，不覆盖服务端已经解析出来的东西：
 *  - 标题空着才用提示
 *  - 图片只增不减，且按 URL 去重
 */
import type { CaptureImage, CaptureResult } from './adapters/types';

export type CaptureHints = {
  title?: string;
  excerpt?: string;
  author?: string;
  images?: string[];
};

/** 单条条目最多保留多少张图，防止恶意/异常页面把 worker 拖死 */
const MAX_IMAGES = 30;

function normalizeUrl(url: string): string {
  return url.trim();
}

/**
 * 把客户端提示并进 adapter 的结果。
 * 纯函数，方便单测（这条逻辑直接影响"图能不能出来"，值得测）。
 */
export function applyHints(
  result: CaptureResult,
  hints: CaptureHints | undefined,
  options: { referer?: string; userAgent?: string; cookie?: string } = {},
): CaptureResult {
  if (!hints) return result;

  const next: CaptureResult = { ...result };
  const warnings = [...result.warnings];
  const known = new Set(result.images.map((i) => normalizeUrl(i.url)));

  // ── 标题：只在解析结果为空时补 ──────────────────────
  if (!next.title && hints.title?.trim()) {
    next.title = hints.title.trim().slice(0, 500);
  }
  if (!next.author && hints.author?.trim()) {
    next.author = hints.author.trim().slice(0, 200);
  }
  if (!next.excerpt && hints.excerpt?.trim()) {
    next.excerpt = hints.excerpt.trim().slice(0, 2000);
  }

  // ── 图片：只补缺，不替换 ────────────────────────────
  const incoming = (hints.images ?? [])
    .map(normalizeUrl)
    .filter((u) => /^https?:\/\//i.test(u))
    .filter((u) => !known.has(u));

  if (incoming.length === 0) {
    next.warnings = warnings;
    return next;
  }

  const room = Math.max(0, MAX_IMAGES - result.images.length);
  const toAdd = incoming.slice(0, room);
  if (toAdd.length === 0) {
    next.warnings = warnings;
    return next;
  }

  const images: CaptureImage[] = [...result.images];
  const htmlParts: string[] = [];
  let index = result.images.length;

  for (const url of toAdd) {
    index += 1;
    const key = `img-${index}`;
    images.push({
      key,
      url,
      referer: options.referer,
      userAgent: options.userAgent,
      cookie: options.cookie,
    });
    htmlParts.push(`<p><img data-pb-img="${key}" /></p>`);
  }

  next.images = images;
  next.contentHtml = [result.contentHtml, ...htmlParts].filter(Boolean).join('\n');
  if (!next.coverUrl && images[0]) next.coverUrl = images[0].url;

  warnings.push(`客户端补充了 ${toAdd.length} 张图片`);
  next.warnings = warnings;

  return next;
}
