/**
 * worker 侧的浏览器渲染调用
 *
 * 只在"普通抓取失败"时才用，不是每次都渲染：
 *   - 渲染一次 2–5 秒，比直接 fetch 慢一个数量级
 *   - 大多数站点（公众号图文、普通网页）根本不需要
 *
 * 服务不可用时静默返回 null —— 抓取退回原来的行为，不让整个队列卡住。
 */
export type RenderResult = {
  html: string;
  finalUrl: string;
  title: string;
  /** 诊断：渲染后页面可见文字长度 */
  textLength?: number;
  /** 诊断：渲染后是否出现 #js_content 正文容器 */
  hasJsContent?: boolean;
};

export type RenderOptions = {
  cookie?: string;
  userAgent?: string;
  waitFor?: string;
};

/** 连续失败这么多次后，暂停使用浏览器一段时间，避免每条都白等 25 秒 */
const FAIL_THRESHOLD = 3;
const COOLDOWN_MS = 5 * 60_000;

type Breaker = { failures: number; openedAt: number | null };
const breaker: Breaker = { failures: 0, openedAt: null };

function breakerOpen(): boolean {
  if (breaker.openedAt === null) return false;
  if (Date.now() - breaker.openedAt > COOLDOWN_MS) {
    // 冷却结束，给一次机会
    breaker.openedAt = null;
    breaker.failures = 0;
    return false;
  }
  return true;
}

function recordFailure(): void {
  breaker.failures += 1;
  if (breaker.failures >= FAIL_THRESHOLD) {
    breaker.openedAt = Date.now();
    console.warn('[browser] 连续失败，暂停使用浏览器 5 分钟');
  }
}

function recordSuccess(): void {
  breaker.failures = 0;
  breaker.openedAt = null;
}

export function browserEnabled(): boolean {
  return Boolean(process.env.BROWSER_URL);
}

/**
 * 已知「服务端抓不到、必须跑 JS」的站点。
 *
 * 对这些站点直接走浏览器，而不是"先失败再重试" —— 省掉一次必然失败的
 * 请求，也避免 adapter 先写一堆解析失败的日志。
 *
 * 判断标准：实测或已知的服务端渲染缺失 / 反爬（返回空壳或 403）。
 * 注意：需要**登录**才能看的站点（Instagram / Facebook / X）即使渲染
 * 也只能拿到登录墙，必须配站点凭据（Cookie）。
 */
const BROWSER_FIRST_HOSTS = [
  // 小红书：整站 SPA，服务端 HTML 只有壳
  'xiaohongshu.com',
  'xhslink.com',
  // 抖音：同理
  'douyin.com',
  'iesdouyin.com',
  // 知乎：反爬强，服务端常返回验证页
  'zhihu.com',
  // 海外社交：内容靠 JS，且大多需要登录 Cookie
  'instagram.com',
  'facebook.com',
  'threads.net',
  'x.com',
  'twitter.com',
];

export function preferBrowser(url: string): boolean {
  if (!browserEnabled()) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return BROWSER_FIRST_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

/** 仅供自检使用：重置熔断状态 */
export function resetBrowserBreaker(): void {
  breaker.failures = 0;
  breaker.openedAt = null;
}

export async function renderWithBrowser(
  url: string,
  options: RenderOptions = {},
): Promise<RenderResult | null> {
  const base = process.env.BROWSER_URL;
  if (!base) return null;
  if (breakerOpen()) return null;

  const timeout = Number(process.env.BROWSER_TIMEOUT_MS ?? 30_000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(`${base.replace(/\/+$/, '')}/render`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        url,
        cookie: options.cookie,
        userAgent: options.userAgent,
        waitFor: options.waitFor,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = (await res.text().catch(() => '')).slice(0, 200);
      console.warn(`[browser] 渲染失败 HTTP ${res.status}: ${body}`);
      recordFailure();
      return null;
    }

    const data = (await res.json()) as RenderResult;
    if (!data?.html || data.html.length < 500) {
      console.warn('[browser] 返回的 HTML 太短，忽略');
      recordFailure();
      return null;
    }

    recordSuccess();
    return data;
  } catch (err) {
    console.warn(
      `[browser] 调用失败: ${err instanceof Error ? err.message : String(err)}`,
    );
    recordFailure();
    return null;
  } finally {
    clearTimeout(timer);
  }
}
