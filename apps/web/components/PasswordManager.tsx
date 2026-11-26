'use client';

import { useState } from 'react';

/**
 * 修改登录密码
 *
 * 三个字段：当前密码 / 新密码 / 确认。
 * 必须验当前密码 —— 只有 cookie 不够，否则 cookie 泄露后攻击者能直接
 * 改密码把主人锁在外面。
 *
 * 改成功会**登出所有设备（包括当前这个）**，所以这里直接跳登录页，
 * 而不是假装还在登录状态。
 */
export default function PasswordManager() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit() {
    if (busy) return;
    setError(null);

    if (next.length < 8) {
      setError('新密码至少 8 位');
      return;
    }
    if (next !== confirm) {
      setError('两次输入的新密码不一致');
      return;
    }

    setBusy(true);
    try {
      const res = await fetch('/api/v1/auth/password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      const body = (await res.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null;

      if (!res.ok) {
        setError(body?.error?.message ?? `修改失败（HTTP ${res.status}）`);
        return;
      }

      setDone(true);
      // 会话已作废，等两秒让人看清提示再跳
      setTimeout(() => {
        window.location.href = '/login';
      }, 1500);
    } catch {
      setError('网络请求失败');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <p className="subtle" style={{ fontSize: 13, lineHeight: 1.7 }}>
        ✅ 密码已修改。<strong>所有设备（包括这台）都已退出登录</strong>，正在跳转登录页…
      </p>
    );
  }

  return (
    <div className="password-form">
      <label className="field">
        <span className="field-label">当前密码</span>
        <input
          className="input"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
      </label>

      <label className="field">
        <span className="field-label">新密码（至少 8 位）</span>
        <input
          className="input"
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
      </label>

      <label className="field">
        <span className="field-label">再输一次新密码</span>
        <input
          className="input"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit();
          }}
        />
      </label>

      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="field-row" style={{ alignItems: 'center' }}>
        <button
          className="btn btn-primary"
          type="button"
          onClick={() => void submit()}
          disabled={busy || !current || !next || !confirm}
        >
          {busy ? '修改中…' : '修改密码'}
        </button>
        <span className="subtle" style={{ fontSize: 12 }}>
          改完需要重新登录
        </span>
      </div>

      <p className="subtle" style={{ fontSize: 11.5, lineHeight: 1.6, marginTop: 10 }}>
        忘了当前密码？删掉 NAS 上的 <code>data/config/auth.json</code> 再重启容器，
        系统会重新生成一个初始密码并打印在日志里（<code>docker compose logs pb-web</code>）。
      </p>
    </div>
  );
}
