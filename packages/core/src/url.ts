/**
 * URL 规范化 + 平台识别（SPEC §6.4、T1.1）
 *
 * 两条 URL 并存，用途不同，千万不要混：
 *   url          —— 原始链接，用于「原文 ↗」跳转（去掉分享参数可能打不开）
 *   canonicalUrl —— 规范化链接，仅用于精确去重
 */

export type PlatformId = 'wechat' | 'xhs' | 'douyin' | 'web';

export type SourceId = 'wechat' | 'xhs' | 'douyin' | 'web';

/** 一律丢弃的追踪参数（小写比较） */
const DROP_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'spm',
  'scm',
  'from',
  'from_source',
  'from_source',
  'share_source',
  'share_medium',
  'share_token',
  'scene',
  'ascene',
  'devicetype',
  'version',
  'nettype',
  'lang',
  'isappinstalled',
  'clicktime',
  'enterid',
  'sessionid',
  'wx_header',
  'exportkey',
  'pass_ticket',
  'nsukey',
  'fbclid',
  'gclid',
  '_hsenc',
  '_hsmi',
  'sharetime',
  'subscene',
]);

/** 微信只保留这四个，它们共同决定文章唯一性 */
const WECHAT_KEEP = new Set(['__biz', 'mid', 'idx', 'sn']);

export function detectPlatform(input: URL): PlatformId {
  const host = input.hostname.toLowerCase();
  if (host === 'mp.weixin.qq.com') return 'wechat';
  if (host.endsWith('xiaohongshu.com') || host.endsWith('xhslink.com')) return 'xhs';
  if (host.endsWith('douyin.com') || host.endsWith('iesdouyin.com')) return 'douyin';
  return 'web';
}

export function parseUrl(input: string): URL | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    // 容忍用户只粘贴 "mp.weixin.qq.com/s/xxx"
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
    const url = new URL(withScheme);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url;
  } catch {
    return null;
  }
}

/**
 * 从一段文本里抠出第一条 URL。
 * 手机端从微信复制过来的分享文案是 "标题\nhttps://..." 这种，需要先抠。
 */
export function extractFirstUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s<>"'）)】\]]+/i);
  return match ? match[0] : null;
}

export function canonicalizeUrl(raw: string): {
  url: string;
  canonicalUrl: string;
  platform: PlatformId;
  source: SourceId;
} | null {
  const parsed = parseUrl(raw);
  if (!parsed) return null;

  const platform = detectPlatform(parsed);
  const original = parsed.toString();

  const url = new URL(parsed.toString());
  url.hash = '';
  url.hostname = url.hostname.toLowerCase();
  if (
    (url.protocol === 'https:' && url.port === '443') ||
    (url.protocol === 'http:' && url.port === '80')
  ) {
    url.port = '';
  }

  const kept = new URLSearchParams();
  for (const [key, value] of url.searchParams.entries()) {
    const k = key.toLowerCase();
    if (platform === 'wechat') {
      if (WECHAT_KEEP.has(k)) kept.append(key, value);
      continue;
    }
    if (DROP_PARAMS.has(k)) continue;
    if (k.startsWith('utm_')) continue;
    // 小红书的 xsec_token / xsec_source 都会变，纳入去重会造成同一条多次入库
    if (platform === 'xhs' && k.startsWith('xsec_')) continue;
    kept.append(key, value);
  }

  // 参数排序，让 a=1&b=2 与 b=2&a=1 归一
  const sorted = [...kept.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  url.search = '';
  for (const [k, v] of sorted) url.searchParams.append(k, v);

  // 末尾斜杠一律去掉（根路径除外）：/post/ 与 /post 是同一个资源，
  // 留着会造成同一篇文章入库两次。
  let pathname = url.pathname;
  if (pathname.length > 1) {
    pathname = pathname.replace(/\/+$/, '');
  }
  url.pathname = pathname || '/';

  return {
    url: original,
    canonicalUrl: url.toString(),
    platform,
    source: platform,
  };
}
