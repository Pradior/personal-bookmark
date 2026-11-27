/**
 * 微信公众号 adapter（SPEC §6.3，本项目最关键的一段）
 *
 * 三个必须做对的地方，错一个就裂图：
 *   1. 图片地址优先级：data-src > data-original > data-lazy-src > src
 *      （src 常常只是灰色占位图，这正是 Karakeep 挂掉的根因）
 *   2. data-src 里的 `&amp;` 必须解码，否则请求 404
 *   3. 下载图片要带 Referer: https://mp.weixin.qq.com/，否则防盗链 403
 */
import * as cheerio from 'cheerio';
import {
  decodeEntities,
  detectBlock,
  fetchHtml,
  FetchError,
  WECHAT_REFERER,
  WECHAT_UA,
} from '../fetcher';
import type { Adapter, CaptureContext, CaptureResult } from './types';
import { countWords } from './types';
import { harvestImages, normalizeText } from './shared';

/** 从页面内联 JS 里捞字符串变量，公众号把元信息都放在这里 */
function grabVar(html: string, name: string): string | undefined {
  const re = new RegExp(`var\\s+${name}\\s*=\\s*(['"])([\\s\\S]*?)\\1`, 'i');
  const m = re.exec(html);
  if (!m?.[2]) return undefined;
  // 页面上常见 'xxx'.html(false) 这种写法，取引号内的原文即可
  const value = decodeEntities(m[2]).trim();
  return value.length > 0 ? value : undefined;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export const wechatAdapter: Adapter = {
  id: 'wechat',
  priority: 100,

  match(url: URL): boolean {
    const host = url.hostname.toLowerCase();
    if (host !== 'mp.weixin.qq.com') return false;
    return url.pathname === '/s' || url.pathname.startsWith('/s/');
  },

  async capture(ctx: CaptureContext): Promise<CaptureResult | null> {
    // 1) 拿到 HTML：客户端送来就不抓，这是本项目相对服务端硬爬的本质优势
    let html = ctx.html;
    let finalUrl = ctx.url.toString();

    if (!html) {
      const res = await fetchHtml(ctx.url.toString(), {
        referer: ctx.referer ?? WECHAT_REFERER,
        userAgent: ctx.userAgent ?? WECHAT_UA,
        cookie: ctx.cookie,
        timeoutMs: ctx.timeoutMs,
        maxBytes: ctx.maxBytes,
      });
      html = res.html;
      finalUrl = res.finalUrl;

      // 被反爬拦下时明确报错，别伪装成"解析失败"
      const blocked = detectBlock(res.html, res.finalUrl);
      if (blocked) {
        throw new FetchError(
          `${blocked}。公众号正文请在浏览器里打开后用扩展或"粘贴正文"保存。`,
          'blocked',
          res.status,
        );
      }
    }

    const warnings: string[] = [];
    const $ = cheerio.load(html);

    // ── 图片消息（公众号的另一种消息类型）─────────────────
    // 正文基本就是一组图片，几乎没有文字，所以没有 #js_content。
    // 2026-11-27 真机：这种文章两个 adapter 都解析不出，最后成了"无标题"的空卡片。
    const $gallery = $('#js_image_content, .image-list, .image_content').first();
    if ($gallery.length > 0) {
      const galleryTitle =
        $('#activity-name').text().trim() ||
        $('meta[property="og:title"]').attr('content')?.trim() ||
        grabVar(html, 'msg_title');

      const desc = normalizeText(
        $('#js_image_desc').text() ||
          $('.image_desc').text() ||
          $('meta[property="og:description"]').attr('content') ||
          '',
      );

      const { images } = harvestImages($, $gallery, {
        referer: WECHAT_REFERER,
        userAgent: WECHAT_UA,
        cookie: ctx.cookie,
      });

      if (images.length > 0) {
        // 描述文字在图片之外，单独拼在正文前面
        const descHtml = desc ? `<p>${escapeHtml(desc)}</p>` : '';
        const contentHtml = [descHtml, ($gallery.html() ?? '').trim()]
          .filter(Boolean)
          .join('\n');

        if (images.length === 0) warnings.push('图片消息里没找到可归档的图片');
        warnings.push(`这是图片消息类型，共 ${images.length} 张图`);

        return {
          type: 'image',
          source: 'wechat',
          title: galleryTitle || undefined,
          author:
            $('#js_name').text().trim() ||
            grabVar(html, 'nickname') ||
            undefined,
          siteName: '公众号',
          excerpt: desc ? desc.slice(0, 120) : undefined,
          contentHtml,
          contentText: normalizeText(`${galleryTitle ?? ''}\n${desc}`),
          coverUrl: images[0]?.url,
          coverReferer: WECHAT_REFERER,
          images,
          rawSnapshot: html,
          meta: { finalUrl, kind: 'image-post', imageCount: images.length },
          warnings,
        };
      }
    }

    // 2) 正文容器
    const $content = $('#js_content');
    if ($content.length === 0 || $content.text().trim().length < 20) {
      /**
       * 兜底：微信改过图片消息的 DOM（类名/ID 会变），上面的选择器可能不命中。
       * 没有 #js_content 但又有一堆内容图，就按图片消息处理。
       *
       * 门槛 ≥3 张：头图、头像、二维码通常只有 1–2 张，混不进这个门槛；
       * worker 那边还会按"源图 <120px"再过滤一次，双重保险。
       */
      if ($('#js_content').length === 0) {
        const { images } = harvestImages($, $('body'), {
          referer: WECHAT_REFERER,
          userAgent: WECHAT_UA,
          cookie: ctx.cookie,
        });

        if (images.length >= 3) {
          const fbTitle =
            $('#activity-name').text().trim() ||
            $('meta[property="og:title"]').attr('content')?.trim() ||
            grabVar(html, 'msg_title');
          const fbDesc = normalizeText(
            $('meta[property="og:description"]').attr('content') ?? '',
          );

          warnings.push(
            `没找到标准正文容器，按图片消息处理（${images.length} 张图）。微信可能改了页面结构。`,
          );

          return {
            type: 'image',
            source: 'wechat',
            title: fbTitle || undefined,
            author: $('#js_name').text().trim() || grabVar(html, 'nickname') || undefined,
            siteName: '公众号',
            excerpt: fbDesc ? fbDesc.slice(0, 120) : undefined,
            contentHtml: $('body').html() ?? '',
            contentText: normalizeText(`${fbTitle ?? ''}\n${fbDesc}`),
            coverUrl: images[0]?.url,
            coverReferer: WECHAT_REFERER,
            images,
            rawSnapshot: html,
            meta: { finalUrl, kind: 'image-post-fallback', imageCount: images.length },
            warnings,
          };
        }
      }

      // 认领了但解析不出来 —— 交给 generic 兜底
      return null;
    }

    // 3) 元信息：DOM 优先，页面变量兜底
    const title =
      $('#activity-name').text().trim() ||
      $('meta[property="og:title"]').attr('content')?.trim() ||
      grabVar(html, 'msg_title');

    const author =
      $('#js_name').text().trim() ||
      $('meta[name="author"]').attr('content')?.trim() ||
      grabVar(html, 'nickname');

    const ogType = $('meta[property="og:type"]').attr('content')?.trim();

    // 发布时间：var ct 是 Unix 秒
    let publishedAt: Date | undefined;
    const ctRaw = grabVar(html, 'ct');
    if (ctRaw && /^\d{9,11}$/.test(ctRaw)) {
      publishedAt = new Date(Number(ctRaw) * 1000);
    } else {
      const text = $('#publish_time').text().trim();
      const parsed = text ? Date.parse(text.replace(/[-/年]/g, '-').replace('月', '-')) : NaN;
      if (!Number.isNaN(parsed)) publishedAt = new Date(parsed);
    }

    // 4) 清掉干扰块（二维码、赞赏、推荐位都不该进归档）
    $content.find('#js_pc_qr_code, #js_pc_qr_code_bottom, .qr_code_pc, #js_pc_qr, #js_profile_qrcode').remove();
    $content.find('script, noscript, iframe, mp-common-profile, mpprofile').remove();

    // 5) 收集图片，顺便把 src 换成占位符（真地址优先级在 shared.ts 里统一）
    const { images } = harvestImages($, $content, {
      referer: WECHAT_REFERER,
      userAgent: WECHAT_UA,
      cookie: ctx.cookie,
    });

    // 6) 正文 HTML / 纯文本
    const contentHtml = ($content.html() ?? '').trim();
    const contentText = normalizeText($content.text());
    if (contentText.length < 20) return null;

    const excerpt =
      grabVar(html, 'msg_desc') || normalizeText(contentText).slice(0, 120);

    const cover =
      grabVar(html, 'msg_cdn_url') ||
      $('meta[property="og:image"]').attr('content')?.trim() ||
      images[0]?.url;

    if (ogType === 'video' || ogType === 'shortvideo') {
      warnings.push('这是视频消息类型，正文里的视频无法归档，只保留了封面与文字');
    }
    const videoCount = $content.find('mpvideo, iframe.video_iframe').length;
    if (videoCount > 0) {
      warnings.push(`正文含 ${videoCount} 个视频，视频本体未归档`);
    }

    return {
      type: 'article',
      source: 'wechat',
      title: title || undefined,
      author: author || undefined,
      siteName: '公众号',
      excerpt,
      contentHtml,
      contentText,
      publishedAt,
      coverUrl: cover,
      coverReferer: WECHAT_REFERER,
      images,
      rawSnapshot: html,
      meta: {
        finalUrl,
        ogType,
        imageCount: images.length,
      },
      warnings,
    };
  },
};

export { countWords };
