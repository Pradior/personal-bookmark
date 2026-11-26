'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

type WorkspaceValue = {
  /** 当前在右栏预览的条目 */
  selectedId: string | null;
  select: (id: string) => void;
  /**
   * 是否宽屏（>=1280px，即右栏真的存在）。
   *
   * 必须在客户端测：服务端不知道视口宽度。首帧是 false，
   * 所以窄屏行为和原来一致（点卡片直接跳转），不会出现
   * "点了没反应"的空档。
   */
  wide: boolean;
};

const WorkspaceContext = createContext<WorkspaceValue | null>(null);

export function useWorkspace(): WorkspaceValue | null {
  return useContext(WorkspaceContext);
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [wide, setWide] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1280px)');
    const apply = () => setWide(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  return (
    <WorkspaceContext.Provider value={{ selectedId, select: setSelectedId, wide }}>
      {children}
    </WorkspaceContext.Provider>
  );
}
