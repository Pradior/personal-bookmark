'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * 列表里有"处理中"的条目时定时刷新（SPEC §9.9）。
 *
 * 用 router.refresh() 而不是轮询接口：它会让服务端组件重新渲染，
 * 列表、计数、侧栏徽标一起更新，也不用在前端再写一套数据合并逻辑。
 */
export default function AutoRefresh({
  active,
  intervalMs = 2500,
}: {
  active: boolean;
  intervalMs?: number;
}) {
  const router = useRouter();

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(timer);
  }, [active, intervalMs, router]);

  return null;
}
