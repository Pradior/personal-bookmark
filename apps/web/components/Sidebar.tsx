import type { SidebarData } from '@/lib/queries';
import Link from 'next/link';
import CollectionCreate from './CollectionCreate';
import NavItem from './NavItem';
import {
  IconBookOpen,
  IconFolder,
  IconInbox,
  IconLayers,
  IconPlus,
  IconSearch,
  IconSettings,
  IconTag,
} from './icons';

type Props = {
  appName: string;
  data: SidebarData | null;
};

function Count({ n }: { n: number }) {
  return <span className={`count${n === 0 ? ' is-zero' : ''}`}>{n}</span>;
}

export default function Sidebar({ appName, data }: Props) {
  const counts = data?.counts ?? { inbox: 0, reading: 0, all: 0, archived: 0 };
  const all = data?.collections ?? [];
  const roots = all.filter((c) => c.parentId === null);

  return (
    <aside className="sidebar" aria-label="导航">
      <div className="brand">
        <span className="brand-mark" aria-hidden>
          {appName.slice(0, 1)}
        </span>
        <span className="brand-name" title={appName}>
          {appName}
        </span>
      </div>

      <div className="sidebar-actions">
        {/* Sprint 1 接保存框；先占位，避免布局跳动 */}
        <button type="button" className="btn btn-primary" disabled title="Sprint 1 开放">
          <IconPlus />
          保存
        </button>
        <button type="button" className="btn btn-icon" disabled title="Sprint 3 开放">
          <IconSearch />
          <span className="sr-only">搜索</span>
        </button>
      </div>

      <div className="sidebar-scroll">
        <div className="nav-section">
          <NavItem href="/inbox">
            <IconInbox className="glyph" />
            <span className="label">收件箱</span>
            <Count n={counts.inbox} />
          </NavItem>
          <NavItem href="/reading">
            <IconBookOpen className="glyph" />
            <span className="label">待读</span>
            <Count n={counts.reading} />
          </NavItem>
          <NavItem href="/all">
            <IconLayers className="glyph" />
            <span className="label">全部条目</span>
            <Count n={counts.all} />
          </NavItem>
        </div>

        <div className="nav-section">
          <div className="nav-label">
            <span>集合</span>
            <CollectionCreate />
          </div>
          {roots.length === 0 ? (
            <p className="nav-empty">还没有集合</p>
          ) : (
            roots.map((root) => {
              const children = all.filter((c) => c.parentId === root.id);
              return (
                <div key={root.id}>
                  <NavItem href={`/collection/${root.id}`}>
                    <IconFolder className="glyph" />
                    <span className="label">{root.name}</span>
                    <Count n={root.count} />
                  </NavItem>
                  {children.map((child) => (
                    <Link
                      key={child.id}
                      href={`/collection/${child.id}`}
                      className="nav-item"
                      style={{ paddingLeft: 30 }}
                    >
                      <span className="label">{child.name}</span>
                      <Count n={child.count} />
                    </Link>
                  ))}
                </div>
              );
            })
          )}
        </div>

        {data && data.tags.length > 0 && (
          <div className="nav-section">
            <div className="nav-label">
              <span>标签</span>
            </div>
            {data.tags.map((name) => (
              <NavItem key={name} href={`/tag/${encodeURIComponent(name)}`}>
                <IconTag className="glyph" />
                <span className="label">{name}</span>
              </NavItem>
            ))}
          </div>
        )}
      </div>

      <div className="sidebar-footer">
        <NavItem href="/settings">
          <IconSettings className="glyph" />
          <span className="label">设置</span>
        </NavItem>
      </div>
    </aside>
  );
}
