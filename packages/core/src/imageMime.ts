/**
 * 图片相关的**纯逻辑**（不依赖 sharp）
 *
 * 单独一个文件的原因：sharp 是原生模块，一旦被 webpack 打包就会在
 * page data 收集阶段报 "Could not load the sharp module"。而 web 因为
 * transpilePackages 会把 @pb/core 的源码编进自己的包，所以 core 的主入口
 * 绝不能出现 sharp —— 这里放的是可以被任何环境安全引用的部分。
 *
 * 真正需要 sharp 的派生逻辑在 imageVariants.ts，仅 worker 与 node 脚本使用。
 */

const MIME_BY_FORMAT: Record<string, string> = {
  svg: 'image/svg+xml',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  heif: 'image/heif',
  tiff: 'image/tiff',
};

const EXT_BY_MIME: Record<string, string> = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
};

/**
 * sharp 的 metadata().format 给的是 `svg` / `jpg` 这种短名，
 * 直接拼成 `image/svg` 是错的 —— 浏览器只认 `image/svg+xml`，否则拒绝渲染。
 * （2026-11-26 真机事故：条目里出现裂图，日志一切正常。）
 */
export function normalizeMime(format: string | undefined, fallback?: string): string {
  const key = (format ?? '').trim().toLowerCase();
  const known = MIME_BY_FORMAT[key];
  if (known) return known;

  const cleaned = (fallback ?? '').split(';')[0]?.trim().toLowerCase();
  if (cleaned && cleaned.startsWith('image/')) {
    return cleaned === 'image/svg' ? 'image/svg+xml' : cleaned;
  }
  return 'application/octet-stream';
}

export function extForMime(mime: string): string {
  return EXT_BY_MIME[mime.split(';')[0]?.trim().toLowerCase() ?? ''] ?? 'bin';
}

export type RenderOptions = {
  /** display 档长边上限 */
  maxEdge: number;
  /** display 档 webp 质量 */
  quality: number;
  /** 小于这个长宽的图直接判定为图标 */
  minEdge: number;
};

/** 两档变体的统一参数：worker 抓取与速记上传都用这一份，避免两边不一致 */
export const DEFAULT_RENDER: RenderOptions = {
  maxEdge: 2000,
  quality: 85,
  minEdge: 120,
};
