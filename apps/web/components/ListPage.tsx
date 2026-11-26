'use client';

import type { ReactNode } from 'react';
import DetailPane from './DetailPane';
import ThemeSwitch from './ThemeSwitch';
import { WorkspaceProvider } from './WorkspaceContext';

type Props = {
  title: string;
  dbReady: boolean;
  children: ReactNode;
  /** 当前搜索词，回填到输入框 */
  searchValue?: string;
};

/**
 * 列表区 + 阅读区骨架（SPEC §9.2 / §9.4 / §9.9）。
 * 三栏断点由 .shell 的 grid 决定，这里只负责两栏的内容。
 *
 * 是客户端组件的唯一原因：右栏预览需要"当前选中哪一条"这个状态，
 * 而选中来自列表点击。状态必须活在两栏的共同祖先里。
 */
export default function ListPage({ title, dbReady, children, searchValue }: Props) {
  return (
    <WorkspaceProvider>
      <main className="list-pane">
        <div className="topbar">
          <span className="topbar-title">{title}</span>
          {/* 用原生 form：不依赖 JS 就能提交，刷新后 URL 里带着 ?q= 也可分享 */}
          <form className="topbar-search" action="/search" method="get" role="search">
            <input
              className="input"
              type="search"
              name="q"
              defaultValue={searchValue}
              placeholder="搜索标题与正文，回车"
              aria-label="搜索"
            />
          </form>
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
        <DetailPane />
      </aside>
    </WorkspaceProvider>
  );
}
