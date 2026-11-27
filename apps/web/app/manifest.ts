import type { MetadataRoute } from 'next';
import { env } from '@/lib/env';

/**
 * PWA 清单（/manifest.webmanifest）
 *
 * 用代码生成而不是放一个静态 site.webmanifest：应用名来自 APP_NAME 环境变量，
 * 静态文件里的 "name" 没法跟着变，装到手机桌面上就会显示成空名字。
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: env.appName,
    short_name: env.appShort || env.appName.slice(0, 4),
    description: '把中文互联网的碎片内容，完整、可检索、永久地搬回自己家。',
    start_url: '/inbox',
    scope: '/',
    display: 'standalone',
    // 与 globals.css 的 --bg / --accent 保持一致，启动画面不会闪一下别的颜色
    background_color: '#FBFAF8',
    theme_color: '#0f766e',
    icons: [
      {
        src: '/android-chrome-192x192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/android-chrome-512x512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/apple-touch-icon.png',
        sizes: '180x180',
        type: 'image/png',
      },
    ],
  };
}
