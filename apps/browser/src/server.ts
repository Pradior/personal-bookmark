/**
 * 无头浏览器服务（可选容器）
 *
 * 存在的理由：越来越多站点把正文改成前端渲染。服务端拿到的 HTML 只是
 * 空壳（微信部分文章 31KB / 0 张图 / 带 vite-legacy 标记，小红书整站如此），
 * 只有真正执行 JS 才会有内容。
 *
 * 这个服务只做一件事：给 URL，返回**渲染后的 HTML**。
 * 解析仍然由 worker 里现有的 adapter 负责 —— 渲染只补上"拿不到 HTML"
 * 这一环，不改变已有的解析与图片管线。
 *
 * 设计取舍：
 *   - 每次请求新建 context（用完就关）：避免 cookie/缓存串味
 *   - 单实例串行（并发 1）：N100 上并行渲染只会互相拖慢，而这里是后台任务
 *   - 失败一律返回 5xx + 原因：worker 据此退回"仅保存链接"，不让整条抓取卡死
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { chromium, type Browser } from 'playwright-core';

const PORT = Number(process.env.PORT ?? 3001);
const EXECUTABLE = process.env.CHROMIUM_PATH || undefined;
/** 单次渲染上限：站点慢的时候别把队列堵死 */
const TIMEOUT_MS = Number(process.env.RENDER_TIMEOUT_MS ?? 25_000);
/** 渲染完再等一会儿，让懒加载图片有机会发出请求 */
const SETTLE_MS = Number(process.env.RENDER_SETTLE_MS ?? 800);
const MAX_CONCURRENCY = Number(process.env.RENDER_CONCURRENCY ?? 1);

type RenderRequest = {
  url: string;
  /** 站点登录态，形如 "a=1; b=2" */
  cookie?: string;
  userAgent?: string;
  /** 等这个选择器出现再返回（可选） */
  waitFor?: string;
  /** 滚动到底，触发懒加载 */
  scroll?: boolean;
};

let browser: Browser | null = null;
let active = 0;
const queue: Array<() => void> = [];

async function getBrowser(): Promise<Browser> {
  if (browser?.isConnected()) return browser;
  browser = await chromium.launch({
    executablePath: EXECUTABLE,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      // 减少最明显的自动化特征；不是万能的，但很多静态检测只看这几项
      '--disable-blink-features=AutomationControlled',
    ],
  });
  return browser;
}

/** 简易信号量：同时只渲染 N 个 */
async function acquire(): Promise<void> {
  if (active < MAX_CONCURRENCY) {
    active += 1;
    return;
  }
  await new Promise<void>((resolve) => queue.push(resolve));
  active += 1;
}

function release(): void {
  active -= 1;
  const next = queue.shift();
  if (next) next();
}

async function render(req: RenderRequest): Promise<{ html: string; finalUrl: string; title: string }> {
  const b = await getBrowser();
  const context = await b.newContext({
    userAgent: req.userAgent,
    viewport: { width: 1280, height: 900 },
    locale: 'zh-CN',
  });

  try {
    if (req.cookie) {
      // 把 "a=1; b=2" 拆成 playwright 要的 cookie 数组；域名从 URL 推
      const { hostname, protocol } = new URL(req.url);
      const cookies = req.cookie
        .split(';')
        .map((part) => part.trim())
        .filter(Boolean)
        .map((pair) => {
          const idx = pair.indexOf('=');
          return {
            name: pair.slice(0, idx),
            value: pair.slice(idx + 1),
            domain: hostname,
            path: '/',
            secure: protocol === 'https:',
          };
        })
        .filter((c) => c.name);
      if (cookies.length > 0) await context.addCookies(cookies);
    }

    const page = await context.newPage();
    page.setDefaultTimeout(TIMEOUT_MS);

    const response = await page.goto(req.url, {
      waitUntil: 'domcontentloaded',
      timeout: TIMEOUT_MS,
    });

    // networkidle 在这类站点上经常永远不空闲（有轮询），所以给个上限
    await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});

    if (req.waitFor) {
      await page.waitForSelector(req.waitFor, { timeout: 8000 }).catch(() => {});
    }

    if (req.scroll !== false) {
      // 分几步滚到底，逼出懒加载图片
      await page
        .evaluate(async () => {
          const step = Math.max(400, window.innerHeight * 0.8);
          for (let y = 0; y < document.body.scrollHeight; y += step) {
            window.scrollTo(0, y);
            await new Promise((r) => setTimeout(r, 120));
          }
          window.scrollTo(0, 0);
        })
        .catch(() => {});
    }

    await page.waitForTimeout(SETTLE_MS);

    const html = await page.content();
    const finalUrl = page.url();
    const title = await page.title().catch(() => '');

    if (!response) {
      // 拿不到 response 一般是导航被中断，但 DOM 已经可用
      console.warn(`[browser] 无响应对象，但仍取到 DOM：${req.url}`);
    }

    return { html, finalUrl, title };
  } finally {
    await context.close().catch(() => {});
  }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 1024 * 1024) throw new Error('请求体过大');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

const server = createServer(async (req, res) => {
  const url = req.url ?? '/';

  if (req.method === 'GET' && url === '/health') {
    json(res, 200, { ok: true, browser: browser?.isConnected() ? 'ready' : 'idle', active });
    return;
  }

  if (req.method !== 'POST' || url !== '/render') {
    json(res, 404, { error: 'not found' });
    return;
  }

  let body: RenderRequest;
  try {
    body = JSON.parse(await readBody(req)) as RenderRequest;
  } catch (err) {
    json(res, 400, { error: `请求体不是合法 JSON：${(err as Error).message}` });
    return;
  }

  if (!body.url || !/^https?:\/\//i.test(body.url)) {
    json(res, 400, { error: 'url 必须是 http(s)' });
    return;
  }

  await acquire();
  try {
    const started = Date.now();
    const result = await render(body);
    console.log(
      `[browser] 渲染完成 ${Math.round((Date.now() - started) / 100) / 10}s ` +
        `${result.html.length}B ${body.url.slice(0, 80)}`,
    );
    json(res, 200, result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[browser] 渲染失败 ${body.url.slice(0, 80)}: ${message}`);
    json(res, 502, { error: message });
  } finally {
    release();
  }
});

server.listen(PORT, () => {
  console.log(`[browser] 监听 :${PORT}，并发 ${MAX_CONCURRENCY}，超时 ${TIMEOUT_MS}ms`);
});

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    console.log(`[browser] 收到 ${signal}，关闭中…`);
    void browser?.close().finally(() => process.exit(0));
  });
}
