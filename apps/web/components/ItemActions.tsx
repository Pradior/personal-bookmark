'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

export type ItemActionState = {
  id: string;
  status: 'inbox' | 'reading' | 'archived';
  /** 速记没有来源链接，不能重新抓取 */
  hasUrl: boolean;
  collectionId: string | null;
};

type Collection = { id: string; name: string };

/**
 * 单条目的操作菜单（⋯）
 *
 * 交互取舍：
 * - 删除要**点两次**（第二次变成红色的「确认删除」），不用 confirm() 弹窗：
 *   原生弹窗在移动端很丑，而且会阻塞整个页面。
 * - 「移到集合」先展开列表而不是塞一个 select —— 菜单里放 select 很难看，
 *   而且要额外点一次才展开。
 * - 集合列表在第一次打开菜单时才拉，避免每张卡片都发一次请求。
 */
export default function ItemActions({
  item,
  variant = 'card',
  onDeleted,
}: {
  item: ItemActionState;
  /** card = 列表里的 ⋯；reader = 阅读页顶栏 */
  variant?: 'card' | 'reader';
  /** 删除成功后回调；不给就自己 refresh / 跳转 */
  onDeleted?: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collections, setCollections] = useState<Collection[] | null>(null);
  const [showCollections, setShowCollections] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      setConfirmDelete(false);
      setShowCollections(false);
      setError(null);
      return;
    }

    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const loadCollections = useCallback(async () => {
    if (collections) return;
    try {
      const res = await fetch('/api/v1/collections', { cache: 'no-store' });
      if (!res.ok) return;
      const body = (await res.json()) as { collections: Collection[] };
      setCollections(body.collections);
    } catch {
      setCollections([]);
    }
  }, [collections]);

  async function patch(body: Record<string, unknown>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/items/${item.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        setError(payload?.error?.message ?? `失败（HTTP ${res.status}）`);
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError('网络请求失败');
    } finally {
      setBusy(false);
    }
  }

  async function retry() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/items/${item.id}/retry`, { method: 'POST' });
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        setError(payload?.error?.message ?? `重新抓取失败（HTTP ${res.status}）`);
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError('网络请求失败');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (busy) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/items/${item.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        setError(payload?.error?.message ?? `删除失败（HTTP ${res.status}）`);
        return;
      }
      setOpen(false);
      if (onDeleted) {
        onDeleted();
      } else if (variant === 'reader') {
        router.push('/inbox');
      } else {
        router.refresh();
      }
    } catch {
      setError('网络请求失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`item-actions is-${variant}${open ? ' is-open' : ''}`} ref={rootRef}>
      <button
        type="button"
        className="btn btn-icon"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="更多操作"
        title="更多操作"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        ⋯
      </button>

      {open ? (
        <div
          className="actions-menu"
          role="menu"
          // 卡片整张是 <a>，菜单里的点击不能触发跳转
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          {item.hasUrl ? (
            <button type="button" role="menuitem" onClick={() => void retry()} disabled={busy}>
              重新抓取
            </button>
          ) : (
            <button type="button" role="menuitem" disabled title="速记没有来源链接">
              重新抓取
            </button>
          )}

          {item.status === 'archived' ? (
            <button type="button" role="menuitem" onClick={() => void patch({ status: 'inbox' })} disabled={busy}>
              移回收件箱
            </button>
          ) : (
            <button type="button" role="menuitem" onClick={() => void patch({ status: 'archived' })} disabled={busy}>
              归档
            </button>
          )}

          {item.status !== 'reading' ? (
            <button type="button" role="menuitem" onClick={() => void patch({ status: 'reading' })} disabled={busy}>
              标为待读
            </button>
          ) : null}

          <div className="actions-sep" role="separator" />

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              void loadCollections();
              setShowCollections((v) => !v);
            }}
            aria-expanded={showCollections}
          >
            移到集合 ▸
          </button>

          {showCollections ? (
            <div className="actions-sub">
              <button
                type="button"
                role="menuitem"
                onClick={() => void patch({ collectionId: null })}
                disabled={busy || item.collectionId === null}
              >
                未归类
              </button>
              {(collections ?? []).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  role="menuitem"
                  onClick={() => void patch({ collectionId: c.id })}
                  disabled={busy || item.collectionId === c.id}
                >
                  {c.name}
                </button>
              ))}
              {collections && collections.length === 0 ? (
                <span className="actions-empty">还没有集合，先去侧栏 ＋ 建一个</span>
              ) : null}
            </div>
          ) : null}

          <div className="actions-sep" role="separator" />

          <button
            type="button"
            role="menuitem"
            className={confirmDelete ? 'is-danger' : undefined}
            onClick={() => void remove()}
            disabled={busy}
          >
            {confirmDelete ? '确认删除（不可恢复）' : '删除'}
          </button>

          {error ? <div className="actions-error">{error}</div> : null}
        </div>
      ) : null}
    </div>
  );
}
