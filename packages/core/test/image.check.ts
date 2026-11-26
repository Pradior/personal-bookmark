/**
 * 图片变体派生的自检
 *
 *   pnpm --filter @pb/core check:image
 *
 * 这里最容易静默出错的点是 MIME：
 * 之前 worker 把 SVG 写成 `image/svg`,浏览器只认 `image/svg+xml`，
 * 于是条目里出现裂图，而日志一切正常。
 */
import sharp from 'sharp';
import { extForMime, normalizeMime, renderVariants } from '../src/imageVariants.ts';

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

console.log('\n[MIME 规范化]');
eq('svg → image/svg+xml', normalizeMime('svg'), 'image/svg+xml');
eq('jpg → image/jpeg', normalizeMime('jpg'), 'image/jpeg');
eq('jpeg → image/jpeg', normalizeMime('jpeg'), 'image/jpeg');
eq('webp → image/webp', normalizeMime('webp'), 'image/webp');
eq('未知格式用 fallback', normalizeMime(undefined, 'image/png; charset=binary'), 'image/png');
eq('fallback 是 image/svg 时纠正', normalizeMime(undefined, 'image/svg'), 'image/svg+xml');
eq('完全没有信息时兜底', normalizeMime(undefined), 'application/octet-stream');

console.log('\n[扩展名]');
eq('webp', extForMime('image/webp'), 'webp');
eq('jpeg 用 jpg', extForMime('image/jpeg'), 'jpg');
eq('svg', extForMime('image/svg+xml'), 'svg');
eq('带 charset 也能识别', extForMime('image/png; charset=binary'), 'png');
eq('未知 → bin', extForMime('application/octet-stream'), 'bin');

console.log('\n[派生两档：普通大图]');
{
  const input = await sharp({
    create: { width: 3200, height: 2000, channels: 3, background: { r: 20, g: 120, b: 110 } },
  })
    .png()
    .toBuffer();

  const v = await renderVariants(input);
  eq('源图 MIME', v.sourceMime, 'image/png');
  eq('display 转成 webp', v.display.mime, 'image/webp');
  eq('display 长边被压到 2000', Math.max(v.display.width ?? 0, v.display.height ?? 0), 2000);
  truthy('display 比源图小', v.display.buf.byteLength < input.byteLength);
  eq('thumb 长边 400', Math.max(v.thumb.width ?? 0, v.thumb.height ?? 0), 400);
  eq('thumb 是 webp', v.thumb.mime, 'image/webp');
  truthy('不是小图', !v.tooSmall);
  truthy('不是动图', !v.animated);
}

console.log('\n[派生：小图被判成图标]');
{
  const icon = await sharp({
    create: { width: 32, height: 32, channels: 3, background: { r: 0, g: 0, b: 0 } },
  })
    .png()
    .toBuffer();

  const v = await renderVariants(icon);
  truthy('32×32 被判为小图', v.tooSmall);
}

console.log('\n[派生：JPEG 输入]');
{
  const jpeg = await sharp({
    create: { width: 800, height: 600, channels: 3, background: { r: 200, g: 100, b: 50 } },
  })
    .jpeg()
    .toBuffer();

  const v = await renderVariants(jpeg);
  eq('源图 MIME 是 jpeg', v.sourceMime, 'image/jpeg');
  eq('display 尺寸不变（小于上限）', v.display.width, 800);
  eq('display 是 webp', v.display.mime, 'image/webp');
}

console.log('\n[派生：SVG 不栅格化]');
{
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#0f766e"/></svg>`,
  );
  const v = await renderVariants(svg);
  eq('源 MIME 是 image/svg+xml', v.sourceMime, 'image/svg+xml');
  truthy('被识别为 svg', v.isSvg);
  eq('display 原样保留', v.display.buf.equals(svg), true);
  eq('display MIME 与源一致', v.display.mime, 'image/svg+xml');
  eq('写盘用 .svg 后缀', extForMime(v.display.mime), 'svg');
}

console.log(`\n结果：${pass} 通过，${fail} 失败\n`);
if (fail > 0) process.exit(1);
