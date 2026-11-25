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

console.log('\n[降级：什么都没有 → 返回 null]');
const empty = await xhsAdapter.capture({
  url: new URL('https://www.xiaohongshu.com/explore/none'),
  html: '<html><body><div>空白页</div></body></html>',
});
eq('返回 null 交给 generic', empty, null);

console.log(`\n结果：${pass} 通过，${fail} 失败\n`);
if (fail > 0) process.exit(1);
