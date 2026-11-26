'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useWorkspace } from './WorkspaceContext';

/**
 * 收件箱键盘流（SPEC §9.7）
 *
 *   J / ↓    下一条
 *   K / ↑    上一条
 *   Enter    打开（进阅读页）
 *   O        新窗口打开原文
 *   E        归档并从列表移除
 *   G / G    回到第一条（连按两次 g）
 *   ?        显示快捷键帮助
 *
 * 实现方式：不接管焦点，只在 `[data-item-id]` 元素上加一个 `.is-focused` 类。
 * 这样不破坏链接语义（Tab 键、右键"在新标签页打开"都还能用）。
 */
export default function InboxKeyboard({ itemCount }: { itemCount: number }) {
  const router = useRouter();
  const workspace = useWorkspace();
  const [index, setIndex] = useState(-1);
  const [helpOpen, setHelpOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const lastKeyRef = useRef<{ key: string; at: number }>({ key: '', at: 0 });

  const cards = useCallback(
    () => Array.from(document.querySelectorAll<HTMLElement>('[data-item-id]')),
    [],
  );

  const focusAt = useCallback(
    (next: number) => {
      const list = cards();
      if (list.length === 0) return;
      const clamped = Math.max(0, Math.min(list.length - 1, next));
      for (const el of list) el.classList.remove('is-focused');
      const el = list[clamped];
      if (!el) return;
      el.classList.add('is-focused');
      el.scrollIntoView({ block: 'nearest' });
      setIndex(clamped);
      // 宽屏下 J/K 直接在右栏预览，符合 feed 阅读器的习惯
      const id = el.dataset.itemId;
      if (workspace?.wide && id) workspace.select(id);
    },
    [cards, workspace],
  );

  // 列表刷新后（新条目进来）保持在同一条上，别跳走
  useEffect(() => {
    if (index < 0) return;
    const list = cards();
    for (const el of list) el.classList.remove('is-focused');
    list[Math.min(index, list.length - 1)]?.classList.add('is-focused');
  }, [cards, index, itemCount]);

  const archive = useCallback(async () => {
    const list = cards();
    const el = list[index];
    const id = el?.dataset.itemId;
    if (!id || busy) return;

    setBusy(true);
    try {
      const res = await fetch(`/api/v1/items/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'archived' }),
      });
      if (res.ok) {
        // 先本地移除，避免等 router.refresh 的往返
        el.remove();
        const remain = cards();
        focusAt(Math.min(index, remain.length - 1));
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }, [busy, cards, focusAt, index, router]);

  const retry = useCallback(async () => {
    const list = cards();
    const id = list[index]?.dataset.itemId;
    if (!id || busy) return;

    setBusy(true);
    try {
      const res = await fetch(`/api/v1/items/${id}/retry`, { method: 'POST' });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }, [busy, cards, index, router]);

  /**
   * 删除要连按两次 d：不可恢复的操作，单键太容易误触。
   * 第一次按下只是"上膛"，1 秒内再按才真正删。
   */
  const remove = useCallback(async () => {
    const list = cards();
    const el = list[index];
    const id = el?.dataset.itemId;
    if (!id || busy) return;

    const now = Date.now();
    const prev = lastKeyRef.current;
    if (!(prev.key === 'd' && now - prev.at < 1000)) {
      lastKeyRef.current = { key: 'd', at: now };
      return;
    }
    lastKeyRef.current = { key: '', at: 0 };

    setBusy(true);
    try {
      const res = await fetch(`/api/v1/items/${id}`, { method: 'DELETE' });
      if (res.ok) {
        el.remove();
        const remain = cards();
        focusAt(Math.min(index, remain.length - 1));
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }, [busy, cards, focusAt, index, router]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (target?.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const key = e.key;
      const lower = key.toLowerCase();

      if (key === '?') {
        e.preventDefault();
        setHelpOpen((v) => !v);
        return;
      }
      if (key === 'Escape') {
        setHelpOpen(false);
        return;
      }
      if (helpOpen) return;

      if (lower === 'j' || key === 'ArrowDown') {
        e.preventDefault();
        focusAt(index + 1);
        return;
      }
      if (lower === 'k' || key === 'ArrowUp') {
        e.preventDefault();
        focusAt(index - 1);
        return;
      }

      const list = cards();
      const current = list[index];

      if (key === 'Enter' && current) {
        e.preventDefault();
        router.push(`/item/${current.dataset.itemId}`);
        return;
      }
      if (lower === 'o' && current) {
        e.preventDefault();
        const url = current.dataset.itemUrl;
        if (url) window.open(url, '_blank', 'noopener,noreferrer');
        return;
      }
      if (lower === 'e' && current) {
        e.preventDefault();
        void archive();
        return;
      }
      if (lower === 'r' && current) {
        e.preventDefault();
        void retry();
        return;
      }
      if (lower === 'd' && current) {
        e.preventDefault();
        void remove();
        return;
      }
      if (lower === 'g') {
        const now = Date.now();
        const prev = lastKeyRef.current;
        if (prev.key === 'g' && now - prev.at < 600) {
          e.preventDefault();
          focusAt(0);
          lastKeyRef.current = { key: '', at: 0 };
        } else {
          lastKeyRef.current = { key: 'g', at: now };
        }
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [archive, cards, focusAt, helpOpen, index, remove, retry, router]);

  return (
    <>
      {index < 0 && itemCount > 0 ? (
        <div className="kbd-hint subtle" aria-hidden>
          按 <kbd>J</kbd> 开始浏览，<kbd>?</kbd> 看快捷键
        </div>
      ) : null}

      {helpOpen ? (
        <div className="kbd-help" role="dialog" aria-modal="true" aria-label="快捷键">
          <div className="kbd-help-panel">
            <div className="kbd-help-head">
              <strong>快捷键</strong>
              <button className="btn btn-ghost" type="button" onClick={() => setHelpOpen(false)}>
                关闭
              </button>
            </div>
            <dl>
              {[
                ['J / ↓', '下一条'],
                ['K / ↑', '上一条'],
                ['Enter', '打开阅读'],
                ['O', '新窗口打开原文'],
                ['E', '归档（移出收件箱）'],
                ['R', '重新抓取'],
                ['D D', '删除（连按两次确认）'],
                ['G G', '回到第一条'],
                ['?', '显示/隐藏本帮助'],
                ['+ / −', '阅读页字号（在阅读页生效）'],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt>
                    <kbd>{k}</kbd>
                  </dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      ) : null}
    </>
  );
}
