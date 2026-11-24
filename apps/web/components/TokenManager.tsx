'use client';

import { useCallback, useEffect, useState } from 'react';
import type { TokenCreated, TokenInfo } from '@pb/contract';

function fmt(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

export default function TokenManager() {
  const [tokens, setTokens] = useState<TokenInfo[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<TokenCreated | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/tokens', { cache: 'no-store' });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        setError(body?.error?.message ?? `读取令牌失败（HTTP ${res.status}）`);
        return;
      }
      const body = (await res.json()) as { tokens: TokenInfo[] };
      setTokens(body.tokens);
      setError(null);
    } catch {
      setError('网络请求失败');
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/tokens', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), scopes: ['capture', 'read', 'write'] }),
      });
      const body = (await res.json().catch(() => null)) as
        | TokenCreated
        | { error?: { message?: string } }
        | null;

      if (!res.ok) {
        setError(
          (body as { error?: { message?: string } } | null)?.error?.message ??
            `创建失败（HTTP ${res.status}）`,
        );
        return;
      }

      setCreated(body as TokenCreated);
      setName('');
      await load();
    } catch {
      setError('网络请求失败');
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/tokens/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        setError(body?.error?.message ?? `删除失败（HTTP ${res.status}）`);
        return;
      }
      await load();
    } catch {
      setError('网络请求失败');
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.token);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('复制失败，请手动选中');
    }
  }

  return (
    <div>
      {created ? (
        <div className="banner" style={{ margin: '0 0 16px' }}>
          <div style={{ width: '100%' }}>
            <strong>令牌已创建，只显示这一次：</strong>
            <div
              className="mono"
              style={{
                margin: '8px 0',
                padding: '8px 10px',
                background: 'var(--bg-sunken)',
                borderRadius: 8,
                wordBreak: 'break-all',
                fontSize: 12,
              }}
            >
              {created.token}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" type="button" onClick={copy}>
                {copied ? '已复制' : '复制'}
              </button>
              <button className="btn btn-ghost" type="button" onClick={() => setCreated(null)}>
                我已保存，关闭
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="field-row">
        <input
          className="input"
          placeholder="令牌名称，例如 浏览器扩展 / iOS 快捷指令"
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void create();
          }}
        />
        <button
          className="btn btn-primary"
          type="button"
          onClick={() => void create()}
          disabled={busy || name.trim().length === 0}
        >
          新建令牌
        </button>
      </div>

      {error ? (
        <p className="form-error" role="alert" style={{ marginTop: 12 }}>
          {error}
        </p>
      ) : null}

      <div style={{ marginTop: 16 }}>
        {!loaded ? (
          <p className="subtle" style={{ fontSize: 13 }}>
            读取中…
          </p>
        ) : tokens.length === 0 ? (
          <p className="subtle" style={{ fontSize: 13 }}>
            还没有令牌。建一个之后就能用 <span className="mono">curl</span> 或扩展访问 API。
          </p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>名称</th>
                <th>前缀</th>
                <th>权限</th>
                <th>创建</th>
                <th>最近使用</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {tokens.map((t) => (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td className="mono">{t.prefix}…</td>
                  <td className="subtle">{t.scopes.join(', ')}</td>
                  <td className="subtle">{fmt(t.createdAt)}</td>
                  <td className="subtle">{fmt(t.lastUsedAt)}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button
                      className="btn btn-ghost"
                      type="button"
                      onClick={() => void revoke(t.id)}
                      disabled={busy}
                    >
                      吊销
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
