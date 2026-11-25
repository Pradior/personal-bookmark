'use client';

import { useCallback, useEffect, useState } from 'react';
import type { CredentialInfo } from '@pb/contract';

const PRESETS = [
  { domain: 'xiaohongshu.com', label: '小红书' },
  { domain: 'mp.weixin.qq.com', label: '微信公众号' },
  { domain: 'douyin.com', label: '抖音' },
];

function fmt(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function CredentialManager() {
  const [list, setList] = useState<CredentialInfo[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okText, setOkText] = useState<string | null>(null);

  const [domain, setDomain] = useState('xiaohongshu.com');
  const [cookie, setCookie] = useState('');
  const [userAgent, setUserAgent] = useState('');
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/credentials', { cache: 'no-store' });
      if (!res.ok) {
        setError(`读取凭据失败（HTTP ${res.status}）`);
        return;
      }
      const body = (await res.json()) as { credentials: CredentialInfo[] };
      setList(body.credentials);
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

  async function save() {
    if (busy) return;
    if (cookie.trim().length < 10) {
      setError('Cookie 太短');
      return;
    }
    setBusy(true);
    setError(null);
    setOkText(null);
    try {
      const res = await fetch('/api/v1/credentials', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          domain: domain.trim(),
          cookie: cookie.trim(),
          userAgent: userAgent.trim() || undefined,
          note: note.trim() || undefined,
          enabled: true,
        }),
      });
      const body = (await res.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null;
      if (!res.ok) {
        setError(body?.error?.message ?? `保存失败（HTTP ${res.status}）`);
        return;
      }
      setCookie('');
      setNote('');
      setOkText('已保存。下次抓取这个域名时会带上它。');
      await load();
    } catch {
      setError('网络请求失败');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/credentials?id=${id}`, { method: 'DELETE' });
      if (!res.ok) {
        setError(`删除失败（HTTP ${res.status}）`);
        return;
      }
      await load();
    } catch {
      setError('网络请求失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="field-row" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 200px', minWidth: 180 }}>
          <label className="subtle" style={{ fontSize: 12 }}>
            域名
          </label>
          <input
            className="input"
            list="pb-cred-presets"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="xiaohongshu.com"
          />
          <datalist id="pb-cred-presets">
            {PRESETS.map((p) => (
              <option key={p.domain} value={p.domain}>
                {p.label}
              </option>
            ))}
          </datalist>
        </div>
        <div style={{ flex: '2 1 260px', minWidth: 220 }}>
          <label className="subtle" style={{ fontSize: 12 }}>
            User-Agent（可选，但要和取 Cookie 的那个浏览器一致）
          </label>
          <input
            className="input"
            value={userAgent}
            onChange={(e) => setUserAgent(e.target.value)}
            placeholder="留空则用默认 UA"
          />
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <label className="subtle" style={{ fontSize: 12 }}>
          Cookie（从浏览器开发者工具里复制整个 Cookie 请求头）
        </label>
        <textarea
          className="input"
          style={{ height: 88, padding: 10, resize: 'vertical', fontFamily: 'monospace', fontSize: 12 }}
          value={cookie}
          onChange={(e) => setCookie(e.target.value)}
          placeholder="a=1; web_session=xxxx; ..."
        />
      </div>

      <div className="field-row" style={{ marginTop: 12 }}>
        <input
          className="input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="备注（可选），例如「主号」"
          maxLength={200}
        />
        <button className="btn btn-primary" type="button" onClick={() => void save()} disabled={busy}>
          {busy ? '保存中…' : '保存凭据'}
        </button>
      </div>

      {error ? (
        <p className="form-error" role="alert" style={{ marginTop: 12 }}>
          {error}
        </p>
      ) : null}
      {okText ? (
        <p className="subtle" style={{ marginTop: 12, fontSize: 12.5, color: 'var(--accent)' }}>
          {okText}
        </p>
      ) : null}

      <div style={{ marginTop: 16 }}>
        {!loaded ? (
          <p className="subtle" style={{ fontSize: 13 }}>
            读取中…
          </p>
        ) : list.length === 0 ? (
          <p className="subtle" style={{ fontSize: 13 }}>
            还没有站点凭据。
          </p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>域名</th>
                <th>Cookie</th>
                <th>状态</th>
                <th>更新时间</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.id}>
                  <td className="mono">{c.domain}</td>
                  <td className="subtle">
                    {c.cookieLength < 0 ? '解密失败' : `${c.cookieLength} 字符`}
                  </td>
                  <td className="subtle">{c.enabled ? '启用' : '停用'}</td>
                  <td className="subtle">{fmt(c.updatedAt)}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button
                      className="btn btn-ghost"
                      type="button"
                      onClick={() => void remove(c.id)}
                      disabled={busy}
                    >
                      删除
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
