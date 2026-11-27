import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { env } from '@/lib/env';

/**
 * 移动端浏览器地址栏配色。Next 15 要求 themeColor 放在 viewport 导出里
 * （放 metadata 会警告）。两档分别对应浅色/深色主题的顶栏颜色。
 */
export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#FBFAF8' },
    { media: '(prefers-color-scheme: dark)', color: '#151412' },
  ],
  colorScheme: 'light dark',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};
export const metadata: Metadata = {
  title: env.appName,
  description: '把中文互联网的碎片内容，完整、可检索、永久地搬回自己家。',
  applicationName: env.appName,
  // 图标放在 public/ 里显式声明，而不是用 app/icon.png 约定：
  // 约定只能给一个尺寸，这里要 16/32/ico/180 四套分别指定
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
    shortcut: [{ url: '/favicon.ico' }],
  },
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: env.appName,
    statusBarStyle: 'default',
  },
};

/**
 * 主题必须在水合前落到 <html data-theme>，否则会闪一下白。
 * 这段脚本刻意内联、极小、且用 try/catch 兜住 localStorage 被禁用的情况。
 */
const themeInitScript = `
(function(){
  try {
    var pref = localStorage.getItem('pb-theme') || 'system';
    var dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var resolved = pref === 'system' ? (dark ? 'dark' : 'light') : pref;
    document.documentElement.dataset.theme = resolved;
    document.documentElement.dataset.themePref = pref;
  } catch (e) {
    document.documentElement.dataset.theme = 'light';
    document.documentElement.dataset.themePref = 'system';
  }
})();
`.trim();

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
