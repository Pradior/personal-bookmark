/**
 * 客户端提示合并的自检
 *
 *   pnpm --filter @pb/core check:hints
 *
 * 这条逻辑决定"扩展抓到的图能不能补进条目"，出错是静默的
 * （条目看起来正常，就是少几张图），所以要有断言。
 */
import { applyHints } from '../src/hints.ts';
import type { CaptureResult } from '../src/adapters/types.ts';

function makeResult(over: Partial<CaptureResult> = {}): CaptureResult {
  return {
    type: 'article',
    source: 'xhs',
    title: '已有标题',
    contentHtml: '<p>正文</p>',
    contentText: '正文',
    images: [],
    meta: {},
    warnings: [],
    ...over,
  };
}

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

console.log('\n[没有提示时原样返回]');
{
  const r = makeResult();
  eq('同一个对象', applyHints(r, undefined), r);
}

console.log('\n[图片：只补缺，不重复]');
{
  const r = makeResult({
    images: [{ key: 'img-1', url: 'https://a/1.jpg' }],
    contentHtml: '<p>正文</p>\n<p><img data-pb-img="img-1" /></p>',
  });
  const merged = applyHints(r, {
    images: ['https://a/1.jpg', 'https://a/2.jpg', 'https://a/3.jpg'],
  });

  eq('原有 1 张 + 新增 2 张', merged.images.length, 3);
  eq('原图不动', merged.images[0]?.key, 'img-1');
  eq('新图接着编号', merged.images[1]?.key, 'img-2');
  eq('HTML 追加了 2 个占位符', (merged.contentHtml.match(/data-pb-img="/g) ?? []).length, 3);
  truthy('有补充提示', merged.warnings.some((w) => w.includes('补充')));
}

console.log('\n[图片：全被已有覆盖时不重复追加]');
{
  const r = makeResult({ images: [{ key: 'img-1', url: 'https://a/1.jpg' }] });
  const merged = applyHints(r, { images: ['https://a/1.jpg'] });
  eq('数量不变', merged.images.length, 1);
  truthy('没有多余的补充提示', !merged.warnings.some((w) => w.includes('补充')));
}

console.log('\n[标题：只在为空时补]');
{
  const withTitle = applyHints(makeResult(), { title: '提示标题' });
  eq('已有标题不被覆盖', withTitle.title, '已有标题');

  const noTitle = applyHints(makeResult({ title: undefined }), { title: '提示标题' });
  eq('空标题被补上', noTitle.title, '提示标题');
}

console.log('\n[清洗：非 http(s) 与超量]');
{
  const r = makeResult();
  const merged = applyHints(r, {
    images: ['data:image/png;base64,xxx', '/relative/a.jpg', 'https://a/ok.jpg'],
  });
  eq('只收 http(s)', merged.images.length, 1);
  eq('留下的是合法地址', merged.images[0]?.url, 'https://a/ok.jpg');
}
{
  const many = Array.from({ length: 50 }, (_, i) => `https://a/${i}.jpg`);
  const merged = applyHints(makeResult(), { images: many });
  truthy('总数被截到 30 以内', merged.images.length <= 30);
  eq('实际截断到 30', merged.images.length, 30);
}

console.log('\n[带上下文：referer / cookie 透传]');
{
  const merged = applyHints(
    makeResult(),
    { images: ['https://a/1.jpg'] },
    { referer: 'https://www.xiaohongshu.com/', cookie: 'a=1' },
  );
  eq('新图带 referer', merged.images[0]?.referer, 'https://www.xiaohongshu.com/');
  eq('新图带 cookie', merged.images[0]?.cookie, 'a=1');
}

console.log('\n[封面：原本没有时用第一张]');
{
  const merged = applyHints(makeResult({ coverUrl: undefined }), {
    images: ['https://a/cover.jpg'],
  });
  eq('封面被补上', merged.coverUrl, 'https://a/cover.jpg');
}

console.log(`\n结果：${pass} 通过，${fail} 失败\n`);
if (fail > 0) process.exit(1);
