import { ping } from '@pb/db';
import CredentialManager from '@/components/CredentialManager';
import LogoutButton from '@/components/LogoutButton';
import PasswordManager from '@/components/PasswordManager';
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

        <Panel title="登录密码" desc="修改管理员密码。改完所有设备都会退出登录。">
          <PasswordManager />
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

        <Panel
          title="站点凭据（Cookie）"
          desc="有些站点未登录只返回空壳页面（小红书最明显），贴一份登录后的 Cookie 才能抓到正文。用 AUTH_SECRET 加密后入库，界面里只显示长度。"
        >
          <CredentialManager />
          <div className="code-block" style={{ marginTop: 16 }}>
            <div className="code-label">怎么拿到 Cookie</div>
            <pre>{`1. 浏览器登录该站点，打开任意一篇内容页
2. F12 → Network → 刷新页面 → 点第一个文档请求
3. 找到 Request Headers 里的 Cookie，整行复制
4. 粘到上面，域名填主域（xiaohongshu.com 能匹配 www 子域）

⚠ Cookie 会过期，抓不到就重新复制一次。
⚠ 不要用账号密码：这些站点登录要短信/扫码，自动登录还会触发风控。`}</pre>
          </div>
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
