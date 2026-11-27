/**
 * 通用 adapter 在真实站点上的自检
 *
 *   pnpm --filter @pb/core check:sites
 *
 * 用最小化的合成 DOM 复现这些站点的正文结构。不是要"精准抓这几个站"，
 * 而是保证 general adapter 的选择器覆盖面够用 —— 无头浏览器把 DOM
 * 渲染好之后，靠的就是这一层把它读出来。
 */
import { genericAdapter } from '../src/adapters/index.ts';

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

const body = (n: number) =>
  Array.from({ length: n }, (_, i) => `<p>这是正文段落 ${i + 1}，用来凑够长度和段落数。</p>`).join(
    '',
  );

async function capture(html: string, url: string) {
  return genericAdapter.capture({ url: new URL(url), html });
}

console.log('\n[知乎：.Post-RichText]');
{
  const html = `<html><head>
      <meta property="og:title" content="如何看待 xxx - 知乎">
      <meta property="og:site_name" content="知乎">
    </head><body>
      <div class="PostAuthor-info">某个答主</div>
      <div class="Post-RichText">${body(6)}</div>
    </body></html>`;

  const r = await capture(html, 'https://www.zhihu.com/question/123/answer/456');
  truthy('解析成功', Boolean(r));
  if (r) {
    truthy('正文进了 contentHtml', r.contentHtml.includes('正文段落 1'));
    truthy('字数够长', r.contentText.length > 100);
    eq('站点名来自 og:site_name', r.siteName, '知乎');
    eq('作者取自 .PostAuthor-info', r.author, '某个答主');
  }
}

console.log('\n[cnbeta：.article-content]');
{
  const html = `<html><head><meta property="og:title" content="某条科技新闻"></head>
    <body><div class="article-content">${body(5)}</div></body></html>`;

  const r = await capture(html, 'https://www.cnbeta.com.tw/articles/tech/123.htm');
  truthy('解析成功', Boolean(r));
  if (r) {
    eq('标题正确', r.title, '某条科技新闻');
    truthy('正文非空', r.contentText.includes('正文段落 2'));
  }
}

console.log('\n[GitHub：article.markdown-body]');
{
  const html = `<html><head><meta property="og:title" content="owner/repo: README"></head>
    <body>
      <article class="markdown-body">${body(8)}</article>
    </body></html>`;

  const r = await capture(html, 'https://github.com/owner/repo');
  truthy('解析成功', Boolean(r));
  if (r) {
    eq('标题正确', r.title, 'owner/repo: README');
    truthy('正文非空', r.contentText.length > 150);
  }
}

console.log('\n[Instagram 风格：登录墙（没有正文）应该判失败]');
{
  const html = `<html><head><meta property="og:title" content="Instagram"></head>
    <body>
      <div class="login-wall"><h2>登录 Instagram</h2><p>登录后即可查看。</p></div>
    </body></html>`;

  const r = await capture(html, 'https://www.instagram.com/p/abc/');
  eq('没有正文时返回 null', r, null);
}

console.log('\n[只有一张图的页面：不当图集]');
{
  const html = `<html><head><meta property="og:title" content="只有头图"></head>
    <body><img src="https://example.com/hero.jpg"><p>短</p></body></html>`;
  const r = await capture(html, 'https://example.com/short');
  eq('1 张图 + 几个字 → null', r, null);
}

console.log(`\n结果：${pass} 通过，${fail} 失败\n`);
if (fail > 0) process.exit(1);
