'use client';

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

type Phase = 'idle' | 'saving' | 'polling' | 'done' | 'duplicate' | 'failed';

const PHASE_TEXT: Record<Phase, string> = {
  idle: '',
  saving: '正在保存…',
  polling: '正在抓取正文与图片…',
  done: '已保存',
  duplicate: '这个链接已经收藏过了',
  failed: '抓取失败',
};

/**
 * 粘贴框：保存一条链接（SPEC T1.9）
 *
 * 交互刻意做成"先返回、后轮询"：采集要下载十几张图，同步等会让用户以为卡死。
 */
export default function SaveBox() {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState('');
  const [itemId, setItemId] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const poll = useCallback(
    async (id: string, deadline: number) => {
      if (Date.now() > deadline) {
        setPhase('failed');
        setMessage('抓取超时，可以稍后在列表里点重试');
        return;
      }

      try {
        const res = await fetch(`/api/v1/items/${id}`, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as { fetchState: string; fetchError?: string | null };

        if (body.fetchState === 'done') {
          setPhase('done');
          setMessage('');
          router.refresh();
          return;
        }
        if (body.fetchState === 'failed') {
          setPhase('failed');
          setMessage(body.fetchError ?? '抓取失败，可稍后重试');
          router.refresh();
          return;
        }
      } catch {
        // 网络抖动不算失败，继续轮询
      }

      timer.current = setTimeout(() => void poll(id, deadline), 1200);
    },
    [router],
  );

  async function submit() {
    const text = value.trim();
    if (!text || phase === 'saving' || phase === 'polling') return;

    setPhase('saving');
    setMessage('');

    try {
      const res = await fetch('/api/v1/capture', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: text, client: 'pwa' }),
      });

      const body = (await res.json().catch(() => null)) as
        | { itemId?: string; duplicate?: boolean; error?: { message?: string } }
        | null;

      if (res.status === 409) {
        setPhase('duplicate');
        setItemId(body?.itemId ?? null);
        setMessage('');
        return;
      }

      if (!res.ok) {
        setPhase('failed');
        setMessage(body?.error?.message ?? `保存失败（HTTP ${res.status}）`);
        return;
      }

      const id = body?.itemId;
      if (!id) {
        setPhase('failed');
        setMessage('服务端没有返回条目 id');
        return;
      }

      setItemId(id);
      setValue('');
      setPhase('polling');
      router.refresh();
      void poll(id, Date.now() + 90_000);
    } catch {
      setPhase('failed');
      setMessage('网络请求失败');
    }
  }

  return (
    <div className="savebox">
      <div className="savebox-row">
        <input
          className="input"
          placeholder="粘贴公众号 / 小红书 / 抖音链接，回车保存"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit();
            if (e.key === 'Escape') setValue('');
          }}
          aria-label="要保存的链接"
        />
        <button
          className="btn btn-primary"
          type="button"
          onClick={() => void submit()}
          disabled={phase === 'saving' || phase === 'polling' || value.trim().length === 0}
        >
          {phase === 'saving' || phase === 'polling' ? '处理中…' : '保存'}
        </button>
      </div>

      {phase !== 'idle' && PHASE_TEXT[phase] ? (
        <div
          className={`savebox-status${phase === 'failed' ? ' is-error' : ''}${
            phase === 'done' ? ' is-ok' : ''
          }`}
          role="status"
        >
          {phase === 'polling' ? <span className="spinner" aria-hidden /> : null}
          <span>
            {PHASE_TEXT[phase]}
            {message ? `：${message}` : ''}
          </span>
          {phase === 'duplicate' && itemId ? (
            <a href={`/item/${itemId}`} style={{ marginLeft: 8 }}>
              打开已有条目
            </a>
          ) : null}
          {phase === 'failed' ? (
            <button
              className="btn btn-ghost"
              type="button"
              style={{ marginLeft: 8, height: 24 }}
              onClick={() => {
                setPhase('idle');
                setMessage('');
              }}
            >
              知道了
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
