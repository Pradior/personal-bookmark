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

/**
 * 从原始 HTML 里扫微信公众号的图片地址。
 *
 * 为什么要这一步：图片消息（以及部分前端渲染的文章）虽然 DOM 里有
 * `#js_content`，但图片不在 `<img>` 标签里 —— 它们以 URL 的形式躺在
 * 页面的内联 JSON / 脚本里。2026-11-27 真机：浏览器渲染出 4.3MB HTML、
 * `#js_content` 有内容、可见文字 157 字，但 `harvestImages` 一张都没找到。
 *
 * 所以退一步：直接在整个 HTML 里找 mmbiz.qpic.cn 的地址。
 * 可靠的部分（正文文字、标题）仍然走 DOM；只有图片走这条路。
 */
function sweepWechatImages(html: string, limit = 20): string[] {
  const re = /https?:\/\/mmbiz\.qpic\.cn\/[^\s"'\\<>()]+/gi;
  const byPath = new Map<string, string>();

  for (const match of html.matchAll(re)) {
    let url = match[0];
    // 内联 JSON 里的转义：\u0026 / \/ / &amp;
    url = url
      .replace(/\\u0026/g, '&')
      .replace(/\\\//g, '/')
      .replace(/&amp;/g, '&')
      .replace(/[),.;"'\\]+$/, '');

    if (!/^https?:\/\//i.test(url)) continue;
    // 只认可归档的位图；gif 多是表情/动图，二维码也常是 png 但尺寸会很小，
    // 后者交给 worker 的「源图 <120px 跳过」兜
    if (!/\/(mmbiz_jpg|mmbiz_png|mmbiz)\//i.test(url)) continue;
    if (/wx_fmt=gif/i.test(url)) continue;

    // 同一张图有多个尺寸变体：/mmbiz_jpg/<hash>/640 与 /mmbiz_jpg/<hash>/0
    // 是同一张图，只差最后那个尺寸段 —— 去重键要去掉它
    let key: string;
    try {
      key = new URL(url).pathname.replace(/\/\d+$/, '');
    } catch {
      key = url;
    }
    if (!byPath.has(key)) byPath.set(key, url);
    if (byPath.size >= limit) break;
  }

  return [...byPath.values()];
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
       *
       * 注意这里**不能**再要求"没有 #js_content" —— 图片消息很可能带着一个
       * 空的（或只有几个字的） #js_content，那种情况下页面照样解析不出来。
       * 只要主页正文分支失败，就按图片处理。
       *
       * 门槛 ≥3 张：头图、头像、二维码通常只有 1–2 张，混不进这个门槛；
       * worker 那边还会按"源图 <120px"再过滤一次，双重保险。
       */
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

      /*
       * 前端渲染的空壳页：微信把部分文章（尤其是分享短链 /s/xxx）改成
       * 客户端渲染，服务端拿到的 HTML 只有 30KB 左右、0 个 <img>、
       * 没有 #js_content，但带 vite-legacy / js_fullscreen_layout_padding 这类标记。
       *
       * 2026-11-27 实测：同一个 URL，服务端 31KB 空壳，
       * 浏览器里正常显示 6 张图。这种只能靠扩展送渲染后的 DOM。
       */
      const isJsShell = /vite-legacy|js_fullscreen_layout_padding/.test(html);
      if (isJsShell) {
        throw new FetchError(
          '这篇的正文由浏览器端 JS 渲染，服务端只能拿到空壳（没有正文也没有图片）。' +
            '请在浏览器里打开这一页，用扩展「保存当前页面」即可完整归档。',
          'blocked',
        );
      }

      // 认领了但解析不出来 —— 交给 generic 兜底
      // 这条日志很关键：失败时看不出原因会反复猜。把三个判据一次打全。
      console.warn(
        `[wechat] 解析不出正文：js_content=${$('#js_content').length} 个，` +
          `正文文字=${normalizeText($('#js_content').text()).length} 字，` +
          `整页可收图片=${images.length} 张，html=${html.length}B`,
      );
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
    let contentHtml = ($content.html() ?? '').trim();
    const contentText = normalizeText($content.text());
    if (contentText.length < 20) return null;

    /**
     * 图片兜底：DOM 里没有 <img> 时，从整页数据里捞 mmbiz 地址。
     * 图片消息的图都在内联 JSON 里（真机：4.3MB HTML、0 个 <img>）。
     */
    if (images.length === 0) {
      const swept = sweepWechatImages(html);
      if (swept.length > 0) {
        swept.forEach((url, i) => {
          const key = `sweep-${i + 1}`;
          images.push({
            key,
            url,
            referer: WECHAT_REFERER,
            userAgent: WECHAT_UA,
            cookie: ctx.cookie,
          });
          contentHtml += `\n<p><img data-pb-img="${key}" /></p>`;
        });
        warnings.push(`正文里没有 <img>，从页面数据中找到 ${swept.length} 张图`);
      }
    }

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
