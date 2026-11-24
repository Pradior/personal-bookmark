'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    setError(null);

    try {
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        setError(body?.error?.message ?? `登录失败（HTTP ${res.status}）`);
        setBusy(false);
        return;
      }

      router.replace(next);
      router.refresh();
    } catch {
      setError('网络请求失败，检查服务是否在运行');
      setBusy(false);
    }
  }

  return (
    <form className="login-form" onSubmit={onSubmit}>
      <label className="sr-only" htmlFor="password">
        管理员密码
      </label>
      <input
        id="password"
        className="input"
        type="password"
        autoComplete="current-password"
        autoFocus
        placeholder="管理员密码"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />

      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}

      <button className="btn btn-primary" type="submit" disabled={busy || password.length === 0}>
        {busy ? '登录中…' : '登录'}
      </button>
    </form>
  );
}
