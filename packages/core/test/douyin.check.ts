/**
 * T1.3 扩展：抖音解析自检
 *
 *   pnpm --filter @pb/core check:douyin
 *
 * 抖音服务端同样有反爬，真实抓取不能当回归测试，所以用自造夹具。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { douyinAdapter, __internal } from '../src/adapters/douyin.ts';
import { pickAdapter } from '../src/adapters/index.ts';
import { sanitizeContent } from '../src/sanitize.ts';

const here = dirname(fileURLToPath(import.meta.url));
const videoHtml = readFileSync(join(here, 'fixtures/douyin-video.html'), 'utf8');
const metaHtml = readFileSync(join(here, 'fixtures/douyin-meta.html'), 'utf8');

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
eq('短链命中 douyin', pickAdapter(new URL('https://v.douyin.com/abc123/')).id, 'douyin');
eq('video 页命中 douyin', pickAdapter(new URL('https://www.douyin.com/video/7300')).id, 'douyin');
eq('iesdouyin 命中 douyin', pickAdapter(new URL('https://www.iesdouyin.com/share/1')).id, 'douyin');
eq('公众号不误判', pickAdapter(new URL('https://mp.weixin.qq.com/s/x')).id, 'wechat');
eq('小红书不误判', pickAdapter(new URL('https://www.xiaohongshu.com/explore/1')).id, 'xhs');

console.log('\n[封面挑选：优先原尺寸]');
eq(
  'cover_original_scale 优先于 cover',
  __internal.pickCover({
    cover: { url_list: ['//a/small.jpeg'] },
    cover_original_scale: { url_list: ['//a/big.jpeg'] },
  }),
  'https://a/big.jpeg',
);
eq('协议相对地址补成 https', __internal.pickCover({ cover: { url_list: ['//x/y.jpg'] } }), 'https://x/y.jpg');
eq('没有封面时返回 undefined', __internal.pickCover({}), undefined);

console.log('\n[解析：_ROUTER_DATA 完整路径]');
const video = await douyinAdapter.capture({
  url: new URL('https://www.douyin.com/video/7300000000000000000'),
  html: videoHtml,
});
if (!video) {
  console.log('  FAIL 解析返回 null');
  process.exit(1);
}
eq('type', video.type, 'video');
eq('source', video.source, 'douyin');
eq('标题取文案第一行', video.title, '第一行文案就是标题');
eq('作者', video.author, '测试博主');
eq('siteName', video.siteName, '抖音');
eq('走的是 router_data 路径', video.meta.via, 'router_data');
eq('时长（秒）', video.meta.durationSec, 15);
eq('封面用原尺寸', video.coverUrl, 'https://p3-sign.douyinpic.com/big.jpeg');
eq('图片数量', video.images.length, 1);
eq('发布时间年份', video.publishedAt?.getUTCFullYear(), 2024);
truthy('正文含 h1 标题', video.contentHtml.includes('<h1>'));
truthy('正文含占位图', video.contentHtml.includes('data-pb-img="img-1"'));
truthy('正文含原站链接', video.contentHtml.includes('在原站打开这条视频'));
truthy('标注了视频未归档', video.warnings.some((w) => w.includes('视频本体未归档')));
truthy('多行文案拆成了多段', (video.contentHtml.match(/<p>/g) ?? []).length >= 2);

console.log('\n[降级：只有 meta]');
const meta = await douyinAdapter.capture({
  url: new URL('https://v.douyin.com/xyz/'),
  html: metaHtml,
});
if (!meta) {
  console.log('  FAIL meta 降级返回 null');
  process.exit(1);
}
eq('标题来自 og:title', meta.title, '只有 meta 的抖音视频');
eq('走的是 meta 路径', meta.meta.via, 'meta');
eq('封面协议被补全', meta.coverUrl, 'https://p3-sign.douyinpic.com/meta-cover.jpeg');
truthy('有降级提示', meta.warnings.some((w) => w.includes('meta')));

console.log('\n[降级：什么都没有 → null]');
const empty = await douyinAdapter.capture({
  url: new URL('https://v.douyin.com/none/'),
  html: '<html><body><div>空白</div></body></html>',
});
eq('返回 null 交给 generic', empty, null);

console.log('\n[清洗]');
const map: Record<string, { assetId: string; sourceAvailable: boolean }> = {};
for (const img of video.images) map[img.key] = { assetId: `a-${img.key}`, sourceAvailable: true };
const cleaned = sanitizeContent(video.contentHtml, map);
eq('无残留占位符', (cleaned.match(/data-pb-img/g) ?? []).length, 0);
truthy('img 指向本地', cleaned.includes('/api/v1/assets/a-img-1'));
truthy('原站链接带 rel', cleaned.includes('rel="noopener noreferrer nofollow"'));

console.log(`\n结果：${pass} 通过，${fail} 失败\n`);
if (fail > 0) process.exit(1);
