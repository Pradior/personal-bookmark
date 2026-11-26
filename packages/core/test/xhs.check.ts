/**
 * T1.3 扩展：小红书解析自检
 *
 *   pnpm --filter @pb/core check:xhs
 *
 * 用自造夹具。小红书服务端基本不放行（要登录态/xsec），
 * 所以真实抓取不能当回归测试。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { xhsAdapter, __internal } from '../src/adapters/xhs.ts';
import { extractJsonObject } from '../src/adapters/shared.ts';
import { pickAdapter } from '../src/adapters/index.ts';
import { sanitizeContent } from '../src/sanitize.ts';

const here = dirname(fileURLToPath(import.meta.url));
const noteHtml = readFileSync(join(here, 'fixtures/xhs-note.html'), 'utf8');
const metaHtml = readFileSync(join(here, 'fixtures/xhs-meta.html'), 'utf8');

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
eq('explore 链接命中 xhs', pickAdapter(new URL('https://www.xiaohongshu.com/explore/abc')).id, 'xhs');
eq('短链命中 xhs', pickAdapter(new URL('https://xhslink.com/a/b')).id, 'xhs');
eq('公众号不会误判为 xhs', pickAdapter(new URL('https://mp.weixin.qq.com/s/x')).id, 'wechat');

console.log('\n[JSON 提取：字符串里的花括号不能打断配平]');
{
  const raw = extractJsonObject(noteHtml, 'window.__INITIAL_STATE__');
  truthy('提取到了对象', typeof raw === 'string' && raw.startsWith('{') && raw.endsWith('}'));
  truthy('包含花括号的字符串没被截断', raw?.includes('花括号') ?? false);
}

console.log('\n[解析：__INITIAL_STATE__ 完整路径]');
const note = await xhsAdapter.capture({
  url: new URL('https://www.xiaohongshu.com/explore/6700abcd1234'),
  html: noteHtml,
});
if (!note) {
  console.log('  FAIL 解析返回 null');
  process.exit(1);
}
eq('标题', note.title, '一条用来验证解析器的测试笔记');
eq('作者', note.author, '测试账号');
eq('siteName', note.siteName, '小红书');
eq('source', note.source, 'xhs');
eq('发布时间年份', note.publishedAt?.getUTCFullYear(), 2024);
eq('走的是 initial_state 路径', note.meta.via, 'initial_state');
eq('图片数量（空 urlDefault 被跳过）', note.images.length, 2);
eq('第 2 张用 urlPre 兜底', note.images[1]?.url.includes('bbb'), true);
eq('HTML 占位符数量一致', (note.contentHtml.match(/data-pb-img="/g) ?? []).length, 2);
eq('width/height 透传', note.contentHtml.includes('width="1080"'), true);
truthy('正文按换行分了段', (note.contentHtml.match(/<p>/g) ?? []).length >= 2);
truthy('标题渲染成 h1', note.contentHtml.includes('<h1>'));
truthy('desc 里的花括号被转义或安全保留', !note.contentHtml.includes('<script>'));

console.log('\n[清洗]');
const map: Record<string, { assetId: string; sourceAvailable: boolean }> = {};
for (const img of note.images) map[img.key] = { assetId: `a-${img.key}`, sourceAvailable: true };
const cleaned = sanitizeContent(note.contentHtml, map);
eq('无残留占位符', (cleaned.match(/data-pb-img/g) ?? []).length, 0);
eq(
  'img src 指向本地',
  (cleaned.match(/<img[^>]+src="\/api\/v1\/assets\//g) ?? []).length,
  2,
);

console.log('\n[降级：只有 meta]');
const meta = await xhsAdapter.capture({
  url: new URL('https://www.xiaohongshu.com/explore/xyz'),
  html: metaHtml,
});
if (!meta) {
  console.log('  FAIL meta 降级也返回 null');
  process.exit(1);
}
eq('标题来自 og:title', meta.title, '只有 meta 的降级笔记');
eq('走的是 meta 路径', meta.meta.via, 'meta');
eq('图片只有封面 1 张', meta.images.length, 1);
truthy('有降级提示', meta.warnings.some((w) => w.includes('meta')));

console.log('\n[登录墙：明确报错，不落成空卡片]');
{
  const loginWallHtml =
    '<html><body><div>登录后查看笔记</div><div>扫码登录小红书</div></body></html>';
  let thrown = '';
  try {
    await xhsAdapter.capture({
      url: new URL('https://www.xiaohongshu.com/explore/login'),
      html: loginWallHtml,
    });
  } catch (err) {
    thrown = (err as Error).message;
  }
  truthy('抛出了 blocked 错误', thrown.includes('需要登录'));
}

console.log('\n[空壳 note：字段全空时不算解析成功]');
{
  const emptyNoteHtml = `<html><body>
    <script>window.__INITIAL_STATE__ = {"note":{"noteDetailMap":{"x":{"note":{"title":"","desc":"","imageList":[]}}}}};</script>
  </body></html>`;
  const r = await xhsAdapter.capture({
    url: new URL('https://www.xiaohongshu.com/explore/empty'),
    html: emptyNoteHtml,
  });
  eq('空壳 note 落到 null（而不是造一条空条目）', r, null);
}

console.log('\n[meta 兜底：标题后缀与散落图片]');
{
  eq('去掉「 - 小红书」后缀', __internal.stripSiteSuffix('南国童话月｜已亮灯 - 小红书'), '南国童话月｜已亮灯');
  eq('没有后缀时原样返回', __internal.stripSiteSuffix('普通标题'), '普通标题');
  eq('空值返回 undefined', __internal.stripSiteSuffix(undefined), undefined);

  const htmlNoOg = `<html><head>
      <meta property="og:title" content="测试笔记 - 小红书" />
      <meta property="og:description" content="只有描述没有 og:image" />
    </head><body>
      <img src="https://sns-webpic-qc.xhscdn.com/2026/aaa.jpg!nd_dft_wlteh_webp_3">
      <img src="https://sns-webpic-qc.xhscdn.com/2026/bbb.webp">
      <script src="https://fe-static.xhscdn.com/app.js"></script>
    </body></html>`;

  const scraped = __internal.collectImageUrls(htmlNoOg);
  eq('从 HTML 里捞到 2 张图', scraped.length, 2);
  truthy('过滤掉了 js 静态资源', !scraped.some((u) => u.includes('app.js')));

  const r = await xhsAdapter.capture({
    url: new URL('https://www.xiaohongshu.com/explore/noog'),
    html: htmlNoOg,
  });
  if (!r) {
    console.log('  FAIL 无 og:image 时不该返回 null');
  } else {
    eq('没有 og:image 也能有图', r.images.length, 2);
    eq('标题后缀被去掉', r.title, '测试笔记');
    eq('封面退到第一张图', r.coverUrl?.includes('aaa.jpg'), true);
  }
}

/**
 * 真机事故（2026-11-26）：走 meta 兜底时把小红书自己的 UI 图标
 * （fe-static.xhscdn.com 上的 32×32 搜索图标）当成了笔记配图存下来，
 * 结果条目里只有一张裂图。
 */
console.log('\n[meta 兜底：不能把站点静态资源当配图]');
{
  const shellHtml = `<html><head>
      <meta property="og:title" content="翡翠台面包超人新版开播 - 小红书" />
      <meta property="og:description" content="粤语新单元" />
    </head><body>
      <link rel="icon" href="https://fe-static.xhscdn.com/formula-static/xhs-pc-web/public/resource/svg/standardSearchIcon.8bb9dd9c.svg">
      <img src="https://fe-static.xhscdn.com/formula-static/xhs-pc-web/public/resource/svg/logo.svg">
      <img src="https://sns-webpic-qc.xhscdn.com/2026/real-note-image.webp">
    </body></html>`;

  const urls = __internal.collectImageUrls(shellHtml);
  eq('只剩真正的笔记图', urls.length, 1);
  truthy('排除了 fe-static 静态资源', !urls.some((u) => u.includes('fe-static')));
  truthy('排除了 svg 图标', !urls.some((u) => u.endsWith('.svg')));

  const r = await xhsAdapter.capture({
    url: new URL('https://www.xiaohongshu.com/explore/shell'),
    html: shellHtml,
  });
  if (!r) {
    console.log('  FAIL 应该能返回结果（有标题和一张真图）');
  } else {
    eq('图片只收真图', r.images.length, 1);
    eq('封面是真图', r.coverUrl?.includes('real-note-image'), true);
    truthy('没有把站点静态资源算进去', !r.images.some((i) => i.url.includes('fe-static')));
  }
}

console.log('\n[扩展路径：从渲染后的 DOM 抽]');
{
  // 模拟扩展送来的、已经渲染完的详情页
  const hydrated = `<html><head>
      <meta property="og:title" content="渲染后的笔记标题 - 小红书" />
      <meta property="og:type" content="article" />
    </head><body>
      <div id="detail-title">渲染后的笔记标题</div>
      <div id="detail-desc"><span>第一段正文内容，够长了。</span><br><span>第二段正文内容。</span></div>
      <div class="author-wrapper"><span class="name">渲染后的作者</span></div>
      <div class="swiper-slide"><img src="https://sns-webpic-qc.xhscdn.com/2026/a.webp"></div>
      <div class="swiper-slide"><img src="https://sns-webpic-qc.xhscdn.com/2026/b.webp"></div>
      <div class="note-slider"><img src="https://sns-webpic-qc.xhscdn.com/2026/a.webp"></div>
      <img src="https://sns-avatar-qc.xhscdn.com/avatar/xxx.jpg">
    </body></html>`;

  const r = await xhsAdapter.capture({
    url: new URL('https://www.xiaohongshu.com/explore/rendered'),
    html: hydrated,
    cookie: 'a=1',
  });

  if (!r) {
    console.log('  FAIL 渲染后的 DOM 应该能解析出来');
  } else {
    eq('走的是 dom 路径', r.meta.via, 'dom');
    eq('标题取自 DOM', r.title, '渲染后的笔记标题');
    eq('作者取自 DOM', r.author, '渲染后的作者');
    truthy('正文包含两段', r.contentText.includes('第一段') && r.contentText.includes('第二段'));
    eq('图片去重后 2 张', r.images.length, 2);
    truthy('没把头像算进去', !r.images.some((i) => i.url.includes('avatar')));
    eq('HTML 占位符数量一致', (r.contentHtml.match(/data-pb-img="/g) ?? []).length, 2);
    eq('封面取第一张图', r.coverUrl?.includes('/a.webp'), true);
    eq('图片带上 cookie 去下载', r.images[0]?.cookie, 'a=1');
  }
}

console.log('\n[降级：什么都没有 → 返回 null]');
const empty = await xhsAdapter.capture({
  url: new URL('https://www.xiaohongshu.com/explore/none'),
  html: '<html><body><div>空白页</div></body></html>',
});
eq('返回 null 交给 generic', empty, null);

console.log(`\n结果：${pass} 通过，${fail} 失败\n`);
if (fail > 0) process.exit(1);
