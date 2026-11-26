/**
 * 小红书 adapter（SPEC §6.3）
 *
 * 和公众号不同：笔记正文不在 DOM 里，而在 `window.__INITIAL_STATE__` 的 JSON 中。
 * 但服务端能否拿到这个 JSON 取决于小红书是否放行——很可能只给 meta 兜底，
 * 所以这里做三级降级：
 *   1. __INITIAL_STATE__ 里的 note 详情（最完整）
 *   2. meta og:* （标题/描述/封面）
 *   3. 都不行 → 返回 null，交给 generic
 */
import * as cheerio from 'cheerio';
import { detectBlock, fetchHtml, FetchError, DESKTOP_UA } from '../fetcher';
import type { Adapter, CaptureContext, CaptureImage, CaptureResult } from './types';
import { extractJsonObject, metaContent, normalizeText } from './shared';
import { extractFromDom } from './xhs-dom';

type XhsNote = {
  title?: string;
  desc?: string;
  time?: number;
  type?: string;
  user?: { nickname?: string; userId?: string };
  imageList?: Array<{ urlDefault?: string; urlPre?: string; width?: number; height?: number }>;
  video?: { media?: { stream?: unknown } };
};

/** 从 __INITIAL_STATE__ 里挖出 note 详情，结构随版本会变，所以层层兜底 */
function findNote(state: unknown): XhsNote | null {
  const root = state as Record<string, unknown> | null;
  if (!root || typeof root !== 'object') return null;

  const note = root.note as Record<string, unknown> | undefined;
  const map = note?.noteDetailMap as Record<string, { note?: XhsNote }> | undefined;
  if (map && typeof map === 'object') {
    for (const key of Object.keys(map)) {
      const candidate = map[key]?.note;
      if (candidate && (candidate.title || candidate.desc || candidate.imageList)) {
        return candidate;
      }
    }
  }

  // 老版本 / 部分页面直接把 note 结构放在 user.note 之类的位置
  const direct = root.noteData ?? root.note_card ?? root.noteCard;
  if (direct && typeof direct === 'object') {
    const d = direct as XhsNote;
    if (d.title || d.desc || d.imageList) return d;
  }

  return null;
}

/** 小红书未登录时会给一个只有壳的页面，这些文案是它的特征 */
const LOGIN_WALL_SIGNALS = [
  '登录后查看',
  '登录后可查看',
  '请先登录',
  '扫码登录',
  '打开小红书App',
  'sns-login',
];

function hasLoginWall(html: string): boolean {
  const head = html.slice(0, 200_000);
  return LOGIN_WALL_SIGNALS.some((s) => head.includes(s));
}

/** note 对象存在但字段全空 —— 和没解析到一样，不能当成功 */
function isEmptyNote(note: XhsNote | null): boolean {
  if (!note) return false;
  const hasText = Boolean(note.title?.trim() || note.desc?.trim());
  const hasImages = (note.imageList ?? []).some((i) => i?.urlDefault || i?.urlPre);
  return !hasText && !hasImages;
}

/**
 * og:title 的形式是「笔记标题 - 小红书」，末尾那截要去掉，
 * 否则列表里每条都拖着一个站名。
 */
function stripSiteSuffix(title: string | undefined): string | undefined {
  if (!title) return undefined;
  const cleaned = title.replace(/\s*[-|–]\s*小红书\s*$/u, '').trim();
  return cleaned.length > 0 ? cleaned : title.trim();
}

/**
 * 从原始 HTML 里捞出图片地址。
 *
 * 走 meta 兜底时经常没有 og:image，但页面的 preload / 内联 JSON 里
 * 往往还散落着 xhscdn 的图片 URL —— 捞出来比一张图都没有强。
 */
function collectImageUrls(html: string, limit = 12): string[] {
  const found = new Set<string>();
  const re = /https?:\/\/[^\s"'\\<>()]+?xhscdn\.com[^\s"'\\<>()]*/gi;

  for (const match of html.matchAll(re)) {
    let url = match[0];
    // 去掉 JSON 转义残留和末尾的标点
    url = url.replace(/\\u002[fF]/g, '/').replace(/[),.;]+$/, '');
    if (!/^https?:\/\//i.test(url)) continue;

    // 小红书的静态资源也在 xhscdn 上（fe-static 域名、/resource/svg/ 路径），
    // 之前就是这样把一个 32×32 的搜索图标当成笔记配图存了下来。
    if (/^https?:\/\/fe-static\./i.test(url)) continue;
    if (url.includes('/resource/')) continue;

    // 小红书的图片地址常带处理后缀：aaa.jpg!nd_dft_wlteh_webp_3
    // 所以判扩展名时要先切掉 ? 和 ! 之后的部分
    const pathPart = url.split(/[?!]/, 1)[0] ?? url;
    // SVG 一律不要：它不是文章配图，而且转码/渲染都麻烦
    if (/\.svg$/i.test(pathPart)) continue;

    const looksLikeImage =
      /\.(jpe?g|png|webp|avif|gif)$/i.test(pathPart) || /\/img\//i.test(url);
    if (!looksLikeImage) continue;

    found.add(url);
    if (found.size >= limit) break;
  }

  return [...found];
}

export const xhsAdapter: Adapter = {
  id: 'xhs',
  priority: 90,

  match(url: URL): boolean {
    const host = url.hostname.toLowerCase();
    return host.endsWith('xiaohongshu.com') || host.endsWith('xhslink.com');
  },

  async capture(ctx: CaptureContext): Promise<CaptureResult | null> {
    let html = ctx.html;
    let finalUrl = ctx.url.toString();
    // 没有客户端 HTML = 服务端自己抓的。小红书这种 SPA，服务端只能拿到空壳，
    // 所以要提示用户改用扩展 —— 但如果是扩展送的 HTML，就别说这句。
    const serverFetched = !ctx.html;

    if (!html) {
      const res = await fetchHtml(ctx.url.toString(), {
        userAgent: ctx.userAgent ?? DESKTOP_UA,
        cookie: ctx.cookie,
        referer: 'https://www.xiaohongshu.com/',
        timeoutMs: ctx.timeoutMs,
        maxBytes: ctx.maxBytes,
      });
      html = res.html;
      finalUrl = res.finalUrl;

      const blocked = detectBlock(res.html, res.finalUrl);
      if (blocked) {
        throw new FetchError(
          `${blocked}。小红书笔记请在浏览器里打开后用扩展保存。`,
          'blocked',
          res.status,
        );
      }
    }

    const warnings: string[] = [];
    const $ = cheerio.load(html);

    const stateRaw = extractJsonObject(html, 'window.__INITIAL_STATE__');
    let note: XhsNote | null = null;
    if (stateRaw) {
      try {
        // 小红书的 state 里直接写 undefined，JSON.parse 会炸。
        // 注意只替换"值位置的 undefined"：带上前面的 : , [ 但不吞掉引号，
        // 否则会把 "key": undefined 变成 "key:null（引号失配）。
        const normalized = stateRaw.replace(/([:,[]\s*)undefined\b/g, '$1null');
        note = findNote(JSON.parse(normalized));
      } catch {
        warnings.push('页面里的 __INITIAL_STATE__ 解析失败，已退回 meta 兜底');
      }
    }

    // 拿到 note 但字段全空，等价于没拿到（未登录时常见）
    if (isEmptyNote(note)) {
      warnings.push('页面里的 note 是空壳（没有标题、正文和图片）');
      note = null;
    }

    // ── 扩展路径：从渲染后的 DOM 里抽（小红书内容只在这里有）──────
    const dom = extractFromDom($, {
      cookie: ctx.cookie,
      userAgent: ctx.userAgent ?? DESKTOP_UA,
      referer: 'https://www.xiaohongshu.com/',
      fallbackTitle: stripSiteSuffix(metaContent($, 'meta[property="og:title"]')),
      fallbackDesc: metaContent($, 'meta[property="og:description"]'),
    });
    if (dom) {
      if (dom.images.length === 0) warnings.push('页面里没找到图片（可能还没加载完，滚动一下再试）');
      if (serverFetched) {
        warnings.push('服务端抓到的可能是空壳页，内容不完整。用浏览器扩展保存这一页能拿到全部正文和图片。');
      }
      return {
        type: 'article',
        source: 'xhs',
        title: dom.title,
        author: dom.author,
        siteName: '小红书',
        excerpt: dom.desc?.slice(0, 120) || undefined,
        contentHtml: dom.contentHtml,
        contentText: dom.contentText,
        coverUrl: dom.images[0]?.url,
        coverReferer: 'https://www.xiaohongshu.com/',
        images: dom.images,
        rawSnapshot: html,
        meta: { finalUrl, imageCount: dom.images.length, via: 'dom' },
        warnings,
      };
    }

    // 没有笔记数据 + 页面出现登录提示 → 明确告诉用户原因，
    // 别让 generic 去抽一段登录文案，最后存成一张"无标题"的空卡片
    if (!note && hasLoginWall(html)) {
      throw new FetchError(
        '小红书需要登录才能查看笔记正文（服务端拿不到数据）。请用浏览器打开后用扩展保存，或把正文复制粘贴过来。',
        'blocked',
      );
    }

    // ── 有完整 note：自己拼正文 ──────────────────────────
    if (note) {
      const title = note.title?.trim() || undefined;
      const desc = (note.desc ?? '').trim();
      const author = note.user?.nickname?.trim() || undefined;

      const images: CaptureImage[] = [];
      const parts: string[] = [];

      if (title) parts.push(`<h1>${escapeHtml(title)}</h1>`);

      if (desc) {
        for (const paragraph of desc.split(/\n+/)) {
          const line = paragraph.trim();
          if (line) parts.push(`<p>${escapeHtml(line)}</p>`);
        }
      }

      let index = 0;
      for (const img of note.imageList ?? []) {
        const url = img?.urlDefault ?? img?.urlPre;
        if (!url) continue;
        index += 1;
        const key = `img-${index}`;
        images.push({
          key,
          url,
          referer: 'https://www.xiaohongshu.com/',
          userAgent: DESKTOP_UA,
          cookie: ctx.cookie,
        });
        const size =
          img.width && img.height ? ` width="${img.width}" height="${img.height}"` : '';
        parts.push(`<p><img data-pb-img="${key}"${size} /></p>`);
      }

      if (note.video) warnings.push('这是视频笔记，视频本体未归档');

      const contentHtml = parts.join('\n');
      const contentText = normalizeText(`${title ?? ''}\n${desc}`);

      if (contentText.length >= 10 || images.length > 0) {
        return {
          type: note.video ? 'video' : 'article',
          source: 'xhs',
          title,
          author,
          siteName: '小红书',
          excerpt: desc.slice(0, 120) || undefined,
          contentHtml,
          contentText,
          publishedAt: note.time ? new Date(note.time) : undefined,
          coverUrl: images[0]?.url,
          coverReferer: 'https://www.xiaohongshu.com/',
          images,
          rawSnapshot: html,
          meta: { finalUrl, imageCount: images.length, via: 'initial_state' },
          warnings,
        };
      }
    }

    // ── 退回 meta 兜底 ──────────────────────────────────
    const ogTitle = stripSiteSuffix(metaContent($, 'meta[property="og:title"]'));
    const ogDesc = metaContent($, 'meta[property="og:description"]');
    const ogImage = metaContent($, 'meta[property="og:image"]');

    // og:image 常常没有，但 HTML 里可能还有别的图
    const scraped = collectImageUrls(html);

    if (!ogTitle && !ogDesc && scraped.length === 0) return null;

    warnings.push('只拿到了页面 meta 信息（小红书未返回笔记数据），正文可能不完整');

    const parts: string[] = [];
    if (ogTitle) parts.push(`<h1>${escapeHtml(ogTitle)}</h1>`);
    if (ogDesc) parts.push(`<p>${escapeHtml(ogDesc)}</p>`);

    const images: CaptureImage[] = [];
    // og:image 的 URL 本身也出现在 HTML 文本里，会被 collectImageUrls 再捞一次，
    // 所以必须先按 og:image 打头、再逐个去重
    const imageUrls: string[] = [];
    const seenUrls = new Set<string>();
    const pushUrl = (candidate: string | undefined): void => {
      if (!candidate || seenUrls.has(candidate)) return;
      seenUrls.add(candidate);
      imageUrls.push(candidate);
    };
    pushUrl(ogImage);
    for (const candidate of scraped) pushUrl(candidate);

    let index = 0;
    for (const url of imageUrls) {
      index += 1;
      const key = `img-${index}`;
      images.push({
        key,
        url,
        referer: 'https://www.xiaohongshu.com/',
        userAgent: DESKTOP_UA,
        cookie: ctx.cookie,
      });
      parts.push(`<p><img data-pb-img="${key}" /></p>`);
      if (index >= 12) break;
    }

    if (images.length === 0) {
      warnings.push('页面里没找到任何图片地址');
    }

    const contentHtml = parts.join('\n');
    const contentText = normalizeText(`${ogTitle ?? ''}\n${ogDesc ?? ''}`);
    if (contentText.length < 5 && images.length === 0) return null;

    return {
      type: 'article',
      source: 'xhs',
      title: ogTitle,
      siteName: '小红书',
      excerpt: ogDesc,
      contentHtml,
      contentText,
      coverUrl: ogImage ?? images[0]?.url,
      coverReferer: 'https://www.xiaohongshu.com/',
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

// 导出给自检脚本用（生产路径不依赖它）
export const __internal = { findNote, stripSiteSuffix, collectImageUrls };
