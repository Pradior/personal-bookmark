'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

type Props = {
  href: string;
  children: ReactNode;
  title?: string;
};

/**
 * 只为了拿 usePathname 做高亮。
 * 侧栏本身是服务端组件（要查计数），所以高亮逻辑单独拆成客户端小组件。
 */
export default function NavItem({ href, children, title }: Props) {
  const pathname = usePathname();
  const active = pathname === href || (href !== '/' && pathname.startsWith(`${href}/`));

  return (
    <Link className="nav-item" href={href} title={title} aria-current={active ? 'page' : undefined}>
      {children}
    </Link>
  );
}
