/**
 * T1.3 / T1.6 离线自检：公众号解析 + HTML 清洗
 *
 *   pnpm --filter @pb/core check:wechat
 *
 * 用自造 HTML 夹具，不依赖网络 —— 公众号在非住宅 IP 上会被验证码拦，
 * 所以真实抓取没法作为回归测试（SPEC §6.5）。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { wechatAdapter, genericAdapter, pickAdapter } from '../src/adapters/index.ts';
import { sanitizeContent, htmlToText } from '../src/sanitize.ts';
import { FetchError } from '../src/fetcher.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(join(here, 'fixtures/wechat-article.html'), 'utf8');
// 图片消息：正文是一组图片，没有 #js_content
const imagePost = readFileSync(join(here, 'fixtures/wechat-image-post.html'), 'utf8');
// 模拟微信改版后的结构（没有标准容器的类名）
const imagePostUnknown = readFileSync(
  join(here, 'fixtures/wechat-image-post-unknown.html'),
  'utf8',
);
// 前端 JS 渲染的空壳页（服务端只能拿到 30KB 左右的骨架）
const jsShell = readFileSync(join(here, 'fixtures/wechat-js-shell.html'), 'utf8');

let pass = 0;
let fail = 0;

function eq(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    pass += 1;
    console.log(`  ok   ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL ${label}\n       实际: ${a}\n       期望: ${e}`);
  }
}

function truthy(label: string, actual: boolean): void {
  if (actual) {
    pass += 1;
    console.log(`  ok   ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL ${label}`);
  }
}

console.log('\n[adapter 路由]');
const longUrl = new URL(
  'https://mp.weixin.qq.com/s?__biz=MzA5&mid=1&idx=1&sn=abc',
);
const shortUrl = new URL('https://mp.weixin.qq.com/s/AbCdEf123');
eq('长链命中 wechat adapter', pickAdapter(longUrl).id, 'wechat');
eq('短链命中 wechat adapter', pickAdapter(shortUrl).id, 'wechat');
eq('普通站点落到 generic', pickAdapter(new URL('https://example.com/a')).id, 'generic');

console.log('\n[解析：传入 HTML，不走网络]');
const result = await wechatAdapter.capture({ url: longUrl, html: fixture });

if (!result) {
  console.log('  FAIL 解析返回 null');
  process.exit(1);
}

eq('标题取 DOM 而非 og/变量', result.title, '一篇用来验证解析器的测试文章');
eq('作者取 #js_name', result.author, '某某研究所');
eq('siteName', result.siteName, '公众号');
eq('发布时间来自 var ct', result.publishedAt?.getUTCFullYear(), 2024);
eq('封面优先取 var msg_cdn_url', result.coverUrl?.includes('cover_from_var'), true);
eq('摘要取 var msg_desc', result.excerpt, '这是页面变量里的摘要');
eq('type', result.type, 'article');
eq('source', result.source, 'wechat');

console.log('\n[图片提取]');
eq('图片数量（占位图那条被删）', result.images.length, 3);
eq('第 1 张走 data-src', result.images[0]?.url.includes('/aaa/'), true);
eq('第 2 张走 data-original', result.images[1]?.url.includes('/bbb/'), true);
eq('第 3 张走 src 兜底', result.images[2]?.url.includes('/ccc/'), true);
eq('&amp; 已解码', result.images[0]?.url.includes('&amp;'), false);
eq('解码后含真实 &', result.images[0]?.url.includes('from=appmsg'), true);
eq('图片带 referer', result.images[0]?.referer, 'https://mp.weixin.qq.com/');
eq(
  'HTML 占位符数量与图片数一致',
  (result.contentHtml.match(/data-pb-img="/g) ?? []).length,
  3,
);

console.log('\n[正文清洗]');
truthy('脚本已从正文移除', !result.contentHtml.includes('evil'));
truthy('iframe 已从正文移除', !result.contentHtml.includes('iframe'));
truthy('二维码块已移除', !result.contentHtml.includes('js_pc_qr_code'));
truthy('inline style 被保留', result.contentHtml.includes('text-align'));
truthy('contentText 长度合理', result.contentText.length > 50);

console.log('\n[sanitize：占位符 → 本地资源]');
const map: Record<string, { assetId: string; sourceAvailable: boolean; width?: number; height?: number }> = {};
for (const img of result.images) {
  map[img.key] = { assetId: `asset-${img.key}`, sourceAvailable: true, width: 1080, height: 720 };
}
const cleaned = sanitizeContent(result.contentHtml, map);

eq('无残留占位符', (cleaned.match(/data-pb-img/g) ?? []).length, 0);
eq(
  'img 的 src 都指向本地资源',
  (cleaned.match(/<img[^>]+src="\/api\/v1\/assets\//g) ?? []).length,
  3,
);
truthy('给了 data-thumb', cleaned.includes('/thumb'));
truthy('给了 data-source（可预览原图）', cleaned.includes('/source'));
truthy('img 带 loading=lazy', cleaned.includes('loading="lazy"'));
truthy('inline style 仍保留', cleaned.includes('text-align'));
truthy('onclick 已剥离', !/\sonclic?k=/i.test(cleaned));
truthy('外链加 rel', cleaned.includes('rel="noopener noreferrer nofollow"'));
truthy('外链 target=_blank', cleaned.includes('target="_blank"'));
truthy('htmlToText 能出文本', htmlToText(cleaned).length > 50);

console.log('\n[图片消息：正文是图片，不能判成解析失败]');
{
  const r = await wechatAdapter.capture({
    url: new URL('https://mp.weixin.qq.com/s/hQPHsxp75jp5v6MDMRTPIQ'),
    html: imagePost,
  });

  if (!r) {
    console.log('  FAIL 图片消息应能解析，不该返回 null');
  } else {
    eq('类型是 image', r.type, 'image');
    eq('标题取自 #activity-name', r.title, '存好！Obsidian全系列保姆指南，一篇顶十篇');
    eq('作者取自 #js_name', r.author, '白叔讲AI');
    eq('抓到 3 张图', r.images.length, 3);
    eq('封面用第一张', r.coverUrl?.includes('mmbiz_jpg/a/640'), true);
    truthy('data-src 优先于 src', Boolean(r.images[0]?.url.includes('mmbiz_jpg/a/640')));
    truthy('&amp; 已解码', Boolean(r.images[0]?.url.includes('&from=appmsg')));
    truthy('描述进了正文', r.contentHtml.includes('从零开始轻松上手'));
    eq(
      '图片已换成占位符',
      (r.contentHtml.match(/data-pb-img="/g) ?? []).length,
      3,
    );
    eq('meta 标记了种类', r.meta.kind, 'image-post');
    truthy('有提示说明这是图片消息', r.warnings.some((w) => w.includes('图片消息')));
  }
}

console.log('\n[图片消息：微信改版后靠兜底也能解析]');
{
  const r = await wechatAdapter.capture({
    url: new URL('https://mp.weixin.qq.com/s/unknownStructure'),
    html: imagePostUnknown,
  });

  if (!r) {
    console.log('  FAIL 结构变了也不该直接判失败');
  } else {
    eq('走的是兜底路径', r.meta.kind, 'image-post-fallback');
    eq('抓到 3 张图', r.images.length, 3);
    eq('标题仍然拿到了', r.title, '改版后的图片消息');
    truthy('有提示说明结构可能变了', r.warnings.some((w) => w.includes('页面结构')));
  }
}

console.log('\n[generic：没有正文的图集页也不该判失败]');
{
  const gallery = `<html><head><meta property="og:title" content="图片墙"></head><body>
    <div class="grid">
      <img src="https://example.com/1.jpg">
      <img src="https://example.com/2.jpg">
      <img src="https://example.com/3.jpg">
    </div>
  </body></html>`;

  const r = await genericAdapter.capture({
    url: new URL('https://example.com/gallery'),
    html: gallery,
  });

  if (!r) {
    console.log('  FAIL 3 张图的页面应能归档成图集');
  } else {
    eq('类型是 image', r.type, 'image');
    eq('抓到 3 张图', r.images.length, 3);
    eq('meta 标记为 gallery', r.meta.kind, 'gallery');
    eq('标题来自 og:title', r.title, '图片墙');
  }

  // 只有 1 张图不该被当成图集（大多只是 logo）
  const one = `<html><head><meta property="og:title" content="x"></head><body>
    <img src="https://example.com/logo.png"></body></html>`;
  const r2 = await genericAdapter.capture({
    url: new URL('https://example.com/one'),
    html: one,
  });
  eq('只有 1 张图仍判失败', r2, null);
}

console.log('\n[图片消息：带一个空的 #js_content 也要能兜住]');
{
  // 图片消息常见的是「有个 #js_content 但里面只有图 / 几个字」。
  // 之前兜底被 `#js_content 长度 === 0` 挡住，这条永远走不到。
  const html = `<html><head>
      <meta property="og:title" content="空正文容器的图片消息">
    </head><body>
      <h1 id="activity-name">空正文容器的图片消息</h1>
      <a id="js_name">某号</a>
      <div id="js_content"><p><br></p></div>
      <div class="swiper">
        <img data-src="https://mmbiz.qpic.cn/p1/640?wx_fmt=jpeg&amp;from=appmsg">
        <img data-src="https://mmbiz.qpic.cn/p2/640?wx_fmt=jpeg&amp;from=appmsg">
        <img data-src="https://mmbiz.qpic.cn/p3/640?wx_fmt=jpeg&amp;from=appmsg">
      </div>
    </body></html>`;

  const r = await wechatAdapter.capture({
    url: new URL('https://mp.weixin.qq.com/s/emptyContent'),
    html,
  });

  if (!r) {
    console.log('  FAIL 空 #js_content 的图片消息应能兜住');
  } else {
    eq('走兜底路径', r.meta.kind, 'image-post-fallback');
    eq('抓到 3 张图', r.images.length, 3);
  }
}

console.log('\n[前端渲染的空壳页：要报明确的错，而不是"解析不出正文"]');
{
  // 真机 2026-11-27：服务端拿到 31KB 空壳（0 个 <img>、无 #js_content），
  // 浏览器里却正常显示 6 张图。这种必须让用户改用扩展，而不是反复重试。
  let caught: unknown = null;
  try {
    await wechatAdapter.capture({
      url: new URL('https://mp.weixin.qq.com/s/hQPHsxp75jp5v6MDMRTPIQ'),
      html: jsShell,
    });
  } catch (err) {
    caught = err;
  }

  truthy('抛出了 FetchError', caught instanceof FetchError);
  const e = caught as FetchError;
  eq('kind 是 blocked（不再尝试 generic）', e.kind, 'blocked');
  truthy('提示里让用户用扩展', /扩展/.test(e.message));
  truthy('说明了是浏览器端渲染', /浏览器端|前端/.test(e.message));
}

console.log('\n[边界：非公众号页面不该被 wechat 认领]');
eq('example.com 不命中', wechatAdapter.match(new URL('https://example.com/s')), false);
eq('generic 永远命中', genericAdapter.match(new URL('https://example.com/x')), true);

console.log(`\n结果：${pass} 通过，${fail} 失败\n`);
if (fail > 0) process.exit(1);
