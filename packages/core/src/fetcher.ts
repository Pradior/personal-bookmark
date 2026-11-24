/**
 * HTTP 抓取封装（SPEC T1.2）
 *
 * 三个关键点，缺一不可：
 *   1. 公众号图片/正文必须带 `Referer: https://mp.weixin.qq.com/`，否则 403
 *   2. 部分文章校验微信内置浏览器 UA
 *   3. 必须有超时和大小上限，否则一个恶意/异常页面能把 worker 拖死
 */

export const WECHAT_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.44(0x18002c2e) NetType/WIFI Language/zh_CN';

export const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export const WECHAT_REFERER = 'https://mp.weixin.qq.com/';

export type FetchOptions = {
  referer?: string;
  userAgent?: string;
  timeoutMs?: number;
  maxBytes?: number;
  /** 默认 2 次（首次 + 1 次重试） */
  retries?: number;
  accept?: string;
};

export type FetchResult = {
  body: Buffer;
  finalUrl: string;
  contentType: string;
  status: number;
  bytes: number;
};

export class FetchError extends Error {
  constructor(
    message: string,
    readonly kind: 'timeout' | 'blocked' | 'too_large' | 'http' | 'network' | 'empty',
    readonly status?: number,
  ) {
    super(message);
    this.name = 'FetchError';
  }
}

const DEFAULTS = {
  timeoutMs: 20_000,
  maxBytes: 20 * 1024 * 1024,
  retries: 2,
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};

/** 二进制抓取（图片/PDF 也用这个） */
export async function fetchBinary(rawUrl: string, options: FetchOptions = {}): Promise<FetchResult> {
  const url = new URL(rawUrl);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new FetchError(`不支持的协议: ${url.protocol}`, 'blocked');
  }

  const maxBytes = options.maxBytes ?? DEFAULTS.maxBytes;
  const retries = options.retries ?? DEFAULTS.retries;
  let lastError: unknown;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      return await once(url, options, maxBytes);
    } catch (err) {
      lastError = err;
      // 明确不该重试的：体积超限、被拦、404
      if (err instanceof FetchError) {
        if (err.kind === 'too_large' || err.kind === 'blocked') throw err;
        if (err.kind === 'http' && err.status && err.status < 500 && err.status !== 429) throw err;
      }
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 600 * attempt));
      }
    }
  }

  if (lastError instanceof FetchError) throw lastError;
  throw new FetchError(
    `抓取失败: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    'network',
  );
}

async function once(url: URL, options: FetchOptions, maxBytes: number): Promise<FetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULTS.timeoutMs);

  try {
    const headers: Record<string, string> = {
      'user-agent': options.userAgent ?? DESKTOP_UA,
      accept: options.accept ?? DEFAULTS.accept,
      'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
    };
    if (options.referer) headers.referer = options.referer;

    const res = await fetch(url, { headers, redirect: 'follow', signal: controller.signal });

    if (!res.ok) {
      throw new FetchError(`HTTP ${res.status} ${res.statusText}`, 'http', res.status);
    }

    const declared = Number(res.headers.get('content-length') ?? '0');
    if (declared && declared > maxBytes) {
      throw new FetchError(`内容过大（声明 ${declared} 字节）`, 'too_large');
    }

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > maxBytes) {
      throw new FetchError(`内容过大（实际 ${buf.byteLength} 字节）`, 'too_large');
    }
    if (buf.byteLength === 0) {
      throw new FetchError('响应为空', 'empty');
    }

    return {
      body: buf,
      finalUrl: res.url || url.toString(),
      contentType: res.headers.get('content-type') ?? '',
      status: res.status,
      bytes: buf.byteLength,
    };
  } catch (err) {
    if (err instanceof FetchError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new FetchError(`超时（${options.timeoutMs ?? DEFAULTS.timeoutMs}ms）`, 'timeout');
    }
    throw new FetchError(
      `网络错误: ${err instanceof Error ? err.message : String(err)}`,
      'network',
    );
  } finally {
    clearTimeout(timer);
  }
}

/** 抓 HTML，自动按 charset 解码 */
export async function fetchHtml(
  rawUrl: string,
  options: FetchOptions = {},
): Promise<{ html: string; finalUrl: string; status: number; bytes: number }> {
  const res = await fetchBinary(rawUrl, options);
  return {
    html: decodeHtml(res.body, res.contentType),
    finalUrl: res.finalUrl,
    status: res.status,
    bytes: res.bytes,
  };
}

/** 从 Content-Type 或 <meta charset> 判断编码；公众号是 utf-8，但别假设 */
export function decodeHtml(buf: Buffer, contentType: string): string {
  const fromHeader = /charset=([^;\s]+)/i.exec(contentType)?.[1]?.toLowerCase();
  let charset = fromHeader;

  if (!charset) {
    const head = buf.subarray(0, 2048).toString('latin1');
    charset = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1]?.toLowerCase();
  }

  const label = charset === 'gb2312' || charset === 'gbk' ? 'gb18030' : charset;

  try {
    return new TextDecoder(label || 'utf-8').decode(buf);
  } catch {
    return buf.toString('utf8');
  }
}

/** 把 HTML 实体（&#39; &amp; 等）解回来，data-src 里常见 */
export function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x0*27;/gi, "'")
    .replace(/&nbsp;/g, ' ');
}

/**
 * 识别"被反爬拦下"而不是"内容真的没有"。
 *
 * 实测（2026-11-24）：从非住宅 IP 抓公众号，会被 302 到
 *   /mp/wappoc_appmsgcaptcha?poc_token=...&target_url=...
 * 这是一个验证页，HTTP 状态仍是 200，HTML 里只有一段 JS。
 * 如果不识别，用户只会看到"解析失败"，根本不知道是被拦了。
 */
const BLOCK_SIGNALS = [
  'wappoc_appmsgcaptcha',
  '完成验证',
  '环境异常',
  '请在微信客户端打开',
  'seccheck',
  '访问过于频繁',
];

export function detectBlock(html: string, finalUrl: string): string | null {
  const haystack = `${finalUrl}\n${html.slice(0, 4000)}`;
  for (const signal of BLOCK_SIGNALS) {
    if (haystack.includes(signal)) {
      return `目标站点触发了人机验证（命中: ${signal}）`;
    }
  }
  return null;
}
