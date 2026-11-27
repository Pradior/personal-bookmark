/**
 * worker 侧的浏览器渲染调用
 *
 * 只在"普通抓取失败"时才用，不是每次都渲染：
 *   - 渲染一次 2–5 秒，比直接 fetch 慢一个数量级
 *   - 大多数站点（公众号图文、普通网页）根本不需要
 *
 * 服务不可用时静默返回 null —— 抓取退回原来的行为，不让整个队列卡住。
 */
export type RenderResult = { html: string; finalUrl: string; title: string };

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
