'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * 失败条目的重试按钮。
 * 重试会清空旧正文并重新入队，所以状态会回到「正在处理」。
 */
export default function RetryButton({ itemId }: { itemId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function retry() {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/v1/items/${itemId}/retry`, { method: 'POST' });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        setMessage(body?.error?.message ?? `重试失败（HTTP ${res.status}）`);
        return;
      }
      router.refresh();
    } catch {
      setMessage('网络请求失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <button className="btn" type="button" onClick={() => void retry()} disabled={busy}>
        {busy ? '已提交…' : '重试抓取'}
      </button>
      {message ? <span style={{ color: 'var(--danger)', fontSize: 12 }}>{message}</span> : null}
    </span>
  );
}
