/** 环境变量集中读取；不在 import 期抛错，避免 next build 阶段就炸 */

function str(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.length > 0 ? v : fallback;
}

function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined) return fallback;
  return v === '1' || v.toLowerCase() === 'true';
}

export const env = {
  nodeEnv: str('NODE_ENV', 'development'),
  appName: str('APP_NAME', '个人bookmark'),
  appShort: str('APP_SHORT', 'pb'),
  authSecret: str('AUTH_SECRET', ''),
  configDir: str('CONFIG_DIR', './data/config'),
  assetsDir: str('ASSETS_DIR', './data/assets'),
  publicBaseUrl: str('PUBLIC_BASE_URL', 'http://localhost:3000'),
  /** 会话 cookie 名；PAT 走 Authorization: Bearer */
  sessionCookie: 'pb_session',
  sessionDays: 30,
  /**
   * 可选：显式指定管理员密码（来自 .env）。
   * 设置后优先于随机生成，适合"我不想翻日志"的场景。
   * 只在一个凭据文件被创建时生效；已存在则以文件为准。
   */
  adminPassword: str('ADMIN_PASSWORD', ''),
  /** 「预览原图」按需回源（ADR-013） */
  maxSourceBytes: Number(str('MAX_SOURCE_BYTES', '33554432')),
  sourceFetchTimeoutMs: Number(str('SOURCE_FETCH_TIMEOUT_MS', '15000')),
  sourceCacheItems: Number(str('SOURCE_CACHE_ITEMS', '50')),
  displayMaxEdge: Number(str('DISPLAY_MAX_EDGE', '2000')),
  displayWebpQuality: Number(str('DISPLAY_WEBP_QUALITY', '85')),
  showDevHints: bool('SHOW_DEV_HINTS', true),
} as const;

export const APP_VERSION = '0.1.0-sprint0';
