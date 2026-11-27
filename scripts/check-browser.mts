/**
 * 无头浏览器调用的自检（不需要真的浏览器）
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/check-browser.mts
 *
 * 用 stub 替换全局 fetch，验证：
 *   - 没配 BROWSER_URL 时完全不发请求
 *   - 成功时返回渲染结果
 *   - 服务报错 / 网络异常时返回 null（抓取退回原行为，不抛错）
 *   - 连续失败 N 次后熔断，不再发请求（否则每条抓取都要白等 30 秒）
 */
const BASE = 'http://pb-browser:3001';

let pass = 0;
let fail = 0;

function ok(label: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    pass += 1;
    console.log(`  ok   ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL ${label}${detail === undefined ? '' : `\n       ${JSON.stringify(detail)}`}`);
  }
}

type FetchLike = typeof fetch;

const realFetch = globalThis.fetch;
let calls: Array<{ url: string; body: unknown }> = [];
let nextResponder: () => Promise<Response> = async () =>
  new Response(JSON.stringify({ html: '<html>x</html>'.repeat(100) }), { status: 200 });

function stubFetch(): void {
  calls = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
    return nextResponder();
  }) as FetchLike;
}

function restoreFetch(): void {
  globalThis.fetch = realFetch;
}

const {
  browserEnabled,
  renderWithBrowser,
  resetBrowserBreaker,
} = await import('../apps/worker/src/browser.ts');

console.log('\n[没配 BROWSER_URL：完全不发请求]');
{
  delete process.env.BROWSER_URL;
  resetBrowserBreaker();
  stubFetch();

  ok('browserEnabled() 是 false', browserEnabled() === false);
  const r = await renderWithBrowser('https://example.com/a');
  ok('返回 null', r === null);
  ok('一次请求都没发', calls.length === 0);

  restoreFetch();
}

console.log('\n[配了 BROWSER_URL：正常渲染]');
{
  process.env.BROWSER_URL = BASE;
  resetBrowserBreaker();
  stubFetch();

  const html = `<html><body><div id="js_content">${'正文'.repeat(300)}</div></body></html>`;
  nextResponder = async () =>
    new Response(JSON.stringify({ html, finalUrl: 'https://example.com/final', title: 'T' }), {
      status: 200,
    });

  const r = await renderWithBrowser('https://example.com/a', {
    cookie: 'a=1',
    userAgent: 'UA',
  });

  ok('拿到 html', Boolean(r?.html.includes('js_content')));
  ok('拿到 finalUrl', r?.finalUrl === 'https://example.com/final');
  ok('请求打到 /render', calls[0]?.url === `${BASE}/render`, calls[0]?.url);
  const body = calls[0]?.body as { url?: string; cookie?: string; userAgent?: string };
  ok('URL 透传', body?.url === 'https://example.com/a');
  ok('cookie 透传', body?.cookie === 'a=1');
  ok('UA 透传', body?.userAgent === 'UA');

  restoreFetch();
}

console.log('\n[服务报错：返回 null，不抛异常]');
{
  process.env.BROWSER_URL = BASE;
  resetBrowserBreaker();
  stubFetch();

  nextResponder = async () => new Response('boom', { status: 502 });
  const r = await renderWithBrowser('https://example.com/b');
  ok('502 时返回 null', r === null);

  restoreFetch();
}

console.log('\n[返回的 HTML 太短：视为失败]');
{
  resetBrowserBreaker();
  stubFetch();
  nextResponder = async () => new Response(JSON.stringify({ html: '<html></html>' }), { status: 200 });

  const r = await renderWithBrowser('https://example.com/c');
  ok('太短的 HTML 被拒', r === null);

  restoreFetch();
}

console.log('\n[连续失败后熔断，不再发请求]');
{
  resetBrowserBreaker();
  stubFetch();
  nextResponder = async () => new Response('down', { status: 500 });

  for (let i = 0; i < 3; i += 1) {
    await renderWithBrowser('https://example.com/d');
  }
  const callsBefore = calls.length;

  const after = await renderWithBrowser('https://example.com/e');
  ok('第 4 次直接返回 null', after === null);
  ok('熔断后没有新请求', calls.length === callsBefore, { before: callsBefore, after: calls.length });

  restoreFetch();
}

console.log('\n[网络异常：返回 null]');
{
  resetBrowserBreaker();
  stubFetch();
  nextResponder = async () => {
    throw new Error('connect ECONNREFUSED');
  };

  const r = await renderWithBrowser('https://example.com/f');
  ok('异常被吞掉并返回 null', r === null);

  restoreFetch();
}

delete process.env.BROWSER_URL;

console.log(`\n结果：${pass} 通过，${fail} 失败\n`);
if (fail > 0) process.exit(1);
