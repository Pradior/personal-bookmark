/**
 * 品牌标（侧栏与登录页共用）
 *
 * 用位图而不是把应用名首字渲染成方块：用户自备了一套 icon，
 * 界面上应该和浏览器标签页、手机主屏是同一个标志。
 *
 * 图省事直接用 192px 的版本缩放到 26px —— 浏览器缩图质量足够，
 * 而且 2x/3x 屏上清晰；单独再切一张 26px 的反而在高分屏会糊。
 */
export default function BrandMark({ size = 26 }: { size?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="brand-mark-img"
      src="/logo.png"
      alt=""
      aria-hidden
      width={size}
      height={size}
    />
  );
}
