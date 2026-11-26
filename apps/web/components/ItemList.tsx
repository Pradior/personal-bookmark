'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ItemSummary } from '@pb/contract';
import ItemCard from './ItemCard';
import { useWorkspace } from './WorkspaceContext';

export type ListMode = 'inbox' | 'trash' | 'browse';

type Collection = { id: string; name: string };

/**
 * 带多选的条目列表
 *
 * 为什么多选状态放在这一层、而不是每张卡片自己管：
 * 全选、Shift 区间选、批量操作都需要知道"整体选中了什么"，
 * 分散到卡片里就得靠 context 或者事件总线，反而更绕。
 */
export default function ItemList({
  items,
  mode,
  collections,
}: {
  items: ItemSummary[];
  mode: ListMode;
  collections?: Collection[];
}) {
  const router = useRouter();
  const workspace = useWorkspace();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmPurge, setConfirmPurge] = useState(false);
  const [showCollections, setShowCollections] = useState(false);

  // 列表变化（刷新/筛选）后，清掉已经不存在的选中项
  useEffect(() => {
    setSelected((prev) => {
      const alive = new Set(items.map((i) => i.id));
      const next = new Set([...prev].filter((id) => alive.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [items]);

  const allSelected = items.length > 0 && selected.size === items.length;

  const toggle = useCallback((id: string, next: boolean) => {
    setSelected((prev) => {
      const copy = new Set(prev);
      if (next) copy.add(id);
      else copy.delete(id);
      return copy;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelected((prev) => (prev.size === items.length ? new Set() : new Set(items.map((i) => i.id))));
  }, [items]);

  const ids = useMemo(() => [...selected], [selected]);

  async function run(action: string, extra?: Record<string, unknown>) {
    if (ids.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/items/batch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, ids, ...extra }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        setError(body?.error?.message ?? `操作失败（HTTP ${res.status}）`);
        return;
      }
      setSelected(new Set());
      setConfirmPurge(false);
      setShowCollections(false);
      router.refresh();
    } catch {
      setError('网络请求失败');
    } finally {
      setBusy(false);
    }
  }

  async function loadCollections() {
    if (collections) return;
    try {
      const res = await fetch('/api/v1/collections', { cache: 'no-store' });
      if (res.ok) setShowCollections(true);
    } catch {
      /* 忽略 */
    }
  }

  return (
    <div className="item-list">
      <div className="list-toolbar">
        <label className="check-all">
          <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="全选" />
          <span>{allSelected ? '取消全选' : '全选'}</span>
        </label>
        <span className="subtle" style={{ fontSize: 12 }}>
          {selected.size > 0 ? `已选 ${selected.size} / ${items.length}` : `共 ${items.length} 条`}
        </span>
      </div>

      <div className="cards">
        {items.map((item) => (
          <ItemCard
            key={item.id}
            item={item}
            selected={selected.has(item.id)}
            onToggle={toggle}
            previewing={workspace?.selectedId === item.id}
          />
        ))}
      </div>

      {selected.size > 0 ? (
        <div className="bulk-bar" role="region" aria-label="批量操作">
          <span className="bulk-count">{selected.size}</span>

          {mode === 'trash' ? (
            <>
              <button className="btn" type="button" onClick={() => void run('restore')} disabled={busy}>
                恢复
              </button>
              <button
                className="btn"
                type="button"
                onClick={() => (confirmPurge ? void run('purge') : setConfirmPurge(true))}
                disabled={busy}
                style={confirmPurge ? { color: 'var(--danger)', borderColor: 'var(--danger)' } : undefined}
              >
                {confirmPurge ? `确认彻底删除（${selected.size}）` : '彻底删除'}
              </button>
            </>
          ) : (
            <>
              <button className="btn" type="button" onClick={() => void run('archived')} disabled={busy}>
                归档
              </button>
              <button className="btn" type="button" onClick={() => void run('reading')} disabled={busy}>
                待读
              </button>
              <button
                className="btn"
                type="button"
                onClick={() => {
                  void loadCollections();
                  setShowCollections((v) => !v);
                }}
                disabled={busy}
              >
                移到集合
              </button>
              <button
                className="btn"
                type="button"
                onClick={() => void run('trash')}
                disabled={busy}
                style={{ color: 'var(--danger)' }}
              >
                删除
              </button>
            </>
          )}

          <button className="btn btn-ghost" type="button" onClick={() => setSelected(new Set())}>
            取消
          </button>

          {showCollections && collections && collections.length > 0 ? (
            <div className="bulk-collections">
              {collections.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => void run('collection', { collectionId: c.id })}
                  disabled={busy}
                >
                  {c.name}
                </button>
              ))}
            </div>
          ) : null}

          {error ? <span className="bulk-error">{error}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
