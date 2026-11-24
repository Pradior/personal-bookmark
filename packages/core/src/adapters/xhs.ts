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
import { metaContent, normalizeText } from './shared';

/** 从 marker 之后找第一个配平的 JSON 对象（字符串里的花括号不能算） */
function extractJsonObject(html: string, marker: string): string | null {
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

    if (!html) {
      const res = await fetchHtml(ctx.url.toString(), {
        userAgent: ctx.userAgent ?? DESKTOP_UA,
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
    const ogTitle = metaContent($, 'meta[property="og:title"]');
    const ogDesc = metaContent($, 'meta[property="og:description"]');
    const ogImage = metaContent($, 'meta[property="og:image"]');

    if (!ogTitle && !ogDesc && !ogImage) return null;

    warnings.push('只拿到了页面 meta 信息（小红书未返回笔记数据），正文可能不完整');

    const parts: string[] = [];
    if (ogTitle) parts.push(`<h1>${escapeHtml(ogTitle)}</h1>`);
    if (ogDesc) parts.push(`<p>${escapeHtml(ogDesc)}</p>`);

    const images: CaptureImage[] = [];
    if (ogImage) {
      images.push({
        key: 'img-1',
        url: ogImage,
        referer: 'https://www.xiaohongshu.com/',
        userAgent: DESKTOP_UA,
      });
      parts.push('<p><img data-pb-img="img-1" /></p>');
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
      coverUrl: ogImage,
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
export const __internal = { extractJsonObject, findNote };
