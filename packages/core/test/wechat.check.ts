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

const here = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(join(here, 'fixtures/wechat-article.html'), 'utf8');

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

console.log('\n[边界：非公众号页面不该被 wechat 认领]');
eq('example.com 不命中', wechatAdapter.match(new URL('https://example.com/s')), false);
eq('generic 永远命中', genericAdapter.match(new URL('https://example.com/x')), true);

console.log(`\n结果：${pass} 通过，${fail} 失败\n`);
if (fail > 0) process.exit(1);
