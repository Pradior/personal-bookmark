import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import { authenticate } from '@/lib/session';
import { getSidebarData } from '@/lib/queries';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const auth = await authenticate();
  if (!auth) redirect('/login');

  // 数据库没起来时返回 null，界面降级但不白屏
  const data = await getSidebarData();

  return (
    <div className="shell">
      <Sidebar appName={env.appName} data={data} />
      {children}
    </div>
  );
}
