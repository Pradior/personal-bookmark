import { ping } from '@pb/db';
import LogoutButton from '@/components/LogoutButton';
import ThemeSwitch from '@/components/ThemeSwitch';
import TokenManager from '@/components/TokenManager';
import { APP_VERSION, env } from '@/lib/env';
import { authenticate } from '@/lib/session';

export const dynamic = 'force-dynamic';

function Panel({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <section className="panel">
      <h2 className="panel-title">{title}</h2>
      {desc ? <p className="panel-desc">{desc}</p> : null}
      {children}
    </section>
  );
}

export default async function SettingsPage() {
  const auth = await authenticate();
  const dbReady = await ping();

  return (
    <main className="list-pane" style={{ borderRight: 'none' }}>
      <div className="topbar">
        <span className="topbar-title">设置</span>
        <div className="topbar-search" />
        <div className="topbar-tools">
          <ThemeSwitch />
        </div>
      </div>

      <div className="list-body" style={{ maxWidth: 860 }}>
        <Panel title="账户" desc="单用户实例，只有一个管理员。">
          <dl className="kv">
            <dt>登录方式</dt>
            <dd>{auth?.method === 'pat' ? '访问令牌（PAT）' : '会话 Cookie'}</dd>
            <dt>权限</dt>
            <dd className="mono">{auth?.scopes.join(', ') ?? '—'}</dd>
          </dl>
          <div style={{ marginTop: 12 }}>
            <LogoutButton />
          </div>
        </Panel>

        <Panel
          title="访问令牌"
          desc="给浏览器扩展、iOS 快捷指令、脚本用的长期凭据。库里只存哈希，明文只显示一次。"
        >
          <TokenManager />
          <div className="code-block" style={{ marginTop: 16 }}>
            <div className="code-label">验证一下（换成你自己的 token）</div>
            <pre>{`curl -s ${env.publicBaseUrl}/api/v1/items \\
  -H "Authorization: Bearer pb_你的令牌" | jq`}</pre>
          </div>
        </Panel>

        <Panel title="外观">
          <p className="panel-desc">三档主题：浅色 / 深色 / 护眼。选「自动」会跟随系统。</p>
          <ThemeSwitch />
        </Panel>

        <Panel title="系统信息">
          <dl className="kv">
            <dt>应用名</dt>
            <dd>{env.appName}</dd>
            <dt>版本</dt>
            <dd className="mono">{APP_VERSION}</dd>
            <dt>数据库</dt>
            <dd>
              {dbReady ? (
                <span style={{ color: 'var(--accent)' }}>已连接</span>
              ) : (
                <span style={{ color: 'var(--warn)' }}>未连接</span>
              )}
            </dd>
            <dt>对外地址</dt>
            <dd className="mono">{env.publicBaseUrl}</dd>
            <dt>配置目录</dt>
            <dd className="mono">{env.configDir}</dd>
            <dt>资源目录</dt>
            <dd className="mono">{env.assetsDir}</dd>
          </dl>
        </Panel>
      </div>
    </main>
  );
}
