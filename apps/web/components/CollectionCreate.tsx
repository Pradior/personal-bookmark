'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * 侧栏「集合」新建入口。
 *
 * 做成行内输入而不是弹窗：新建集合是一个非常轻的动作，
 * 弹一层 dialog 反而比直接打字慢。
 */
export default function CollectionCreate() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed || busy) return;

    setBusy(true);
    try {
      const res = await fetch('/api/v1/collections', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      if (res.ok) {
        setName('');
        setOpen(false);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        className="nav-plus"
        onClick={() => setOpen(true)}
        title="新建集合"
        aria-label="新建集合"
      >
        ＋
      </button>
    );
  }

  return (
    <input
      className="nav-inline-input"
      autoFocus
      value={name}
      onChange={(e) => setName(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') void submit();
        if (e.key === 'Escape') {
          setName('');
          setOpen(false);
        }
      }}
      onBlur={() => {
        if (!name.trim()) setOpen(false);
      }}
      placeholder="集合名"
      aria-label="集合名"
      maxLength={120}
    />
  );
}
