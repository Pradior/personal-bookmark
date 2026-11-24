import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { env } from '@/lib/env';

export const metadata: Metadata = {
  title: env.appName,
  description: '把中文互联网的碎片内容，完整、可检索、永久地搬回自己家。',
  applicationName: env.appName,
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
