/**
 * 图片变体派生（需要 sharp 的那一半）
 *
 * 纯逻辑（MIME 映射、尺寸策略）在 imageMime.ts —— 那份不依赖 sharp，
 * 可以被 web 安全引用。这个文件只给 worker 和 node 脚本用。
 *
 * 为什么必须分开：web 通过 transpilePackages 把 @pb/core 的源码编进自己
 * 的包，一旦 core 主入口出现 `import sharp`，webpack 会把 sharp 也打进去，
 * 构建阶段就报 "Could not load the sharp module using the win32-x64 runtime"。
 *
 * 为什么只有这一份实现：之前 worker 自己算 MIME，把 SVG 写成了 `image/svg`
 * （浏览器只认 `image/svg+xml`），结果条目里全是裂图，而日志一切正常。
 */
import sharp from 'sharp';
import { DEFAULT_RENDER, extForMime, normalizeMime, type RenderOptions } from './imageMime';

export { DEFAULT_RENDER, extForMime, normalizeMime };
export type { RenderOptions };

export type VariantBuffer = {
  buf: Buffer;
  mime: string;
  width?: number;
  height?: number;
};

export type RenderedVariants = {
  /** 源图真实 MIME（已规范化） */
  sourceMime: string;
  animated: boolean;
  isSvg: boolean;
  sourceWidth?: number;
  sourceHeight?: number;
  /** 小图判定：长宽都小于阈值，几乎肯定是图标/头像，调用方应跳过 */
  tooSmall: boolean;
  display: VariantBuffer;
  thumb: VariantBuffer;
};

/**
 * 输入原始字节，输出两档变体。
 * 抛错由调用方决定怎么处理（单张图失败不该让整篇失败）。
 */
export async function renderVariants(
  input: Buffer,
  options: Partial<RenderOptions> = {},
): Promise<RenderedVariants> {
  const opts = { ...DEFAULT_RENDER, ...options };

  const meta = await sharp(input, { animated: true }).metadata();
  const sourceMime = normalizeMime(meta.format);
  const animated = (meta.pages ?? 1) > 1;
  const isSvg = sourceMime === 'image/svg+xml';

  const w0 = meta.width ?? 0;
  const h0 = meta.height ?? 0;
  const tooSmall = !animated && w0 > 0 && h0 > 0 && w0 < opts.minEdge && h0 < opts.minEdge;

  let display: VariantBuffer;
  if (animated || isSvg) {
    // 动图转码会丢帧；SVG 不该被栅格化 —— 两者都原样保存
    display = { buf: input, mime: sourceMime, width: meta.width, height: meta.height };
  } else {
    const out = await sharp(input)
      .rotate() // 按 EXIF 摆正，同时剥掉 EXIF（含 GPS）
      .resize({
        width: opts.maxEdge,
        height: opts.maxEdge,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: opts.quality })
      .toBuffer({ resolveWithObject: true });
    display = { buf: out.data, mime: 'image/webp', width: out.info.width, height: out.info.height };
  }

  const thumbOut = await sharp(input, { animated: false })
    .rotate()
    .resize({ width: 400, height: 400, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 75 })
    .toBuffer({ resolveWithObject: true });

  return {
    sourceMime,
    animated,
    isSvg,
    sourceWidth: meta.width,
    sourceHeight: meta.height,
    tooSmall,
    display,
    thumb: {
      buf: thumbOut.data,
      mime: 'image/webp',
      width: thumbOut.info.width,
      height: thumbOut.info.height,
    },
  };
}
