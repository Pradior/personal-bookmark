import type { ReactNode } from 'react';
import ThemeSwitch from './ThemeSwitch';
import { IconLayers } from './icons';

type Props = {
  title: string;
  dbReady: boolean;
  children: ReactNode;
};

/**
 * 列表区 + 阅读区骨架（SPEC §9.2 / §9.4 / §9.9）。
 * 三栏断点由 .shell 的 grid 决定，这里只负责两栏的内容。
 */
export default function ListPage({ title, dbReady, children }: Props) {
  return (
    <>
      <main className="list-pane">
        <div className="topbar">
          <span className="topbar-title">{title}</span>
          <div className="topbar-search">
            <input
              className="input"
              type="search"
              placeholder="搜索（Sprint 3）"
              aria-label="搜索"
              disabled
            />
          </div>
          <div className="topbar-tools">
            <ThemeSwitch />
          </div>
        </div>

        {!dbReady && (
          <div className="banner is-warn" role="status">
            <div>
              <strong>数据库未连接。</strong> 界面已就绪，但列表与计数都是空的。
              <br />
              本地开发：<code>docker compose up -d pb-db</code> 然后 <code>pnpm db:migrate</code>。
              也可以打开 <code>/api/v1/health</code> 看诊断。
            </div>
          </div>
        )}

        <div className="list-body">{children}</div>
      </main>

      <aside className="detail-pane" aria-label="阅读区">
        <div className="detail-empty">
          <IconLayers width={22} height={22} />
          <span>选中条目后在这里阅读</span>
          <span className="subtle" style={{ fontSize: 12 }}>
            窄屏会改用独立阅读页
          </span>
        </div>
      </aside>
    </>
  );
}
