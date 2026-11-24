import { redirect } from 'next/navigation';
import { authenticate } from '@/lib/session';
import { bootstrapAuth } from '@/lib/auth';
import { env } from '@/lib/env';
import LoginForm from './LoginForm';

export const dynamic = 'force-dynamic';

type Props = {
  searchParams: Promise<{ next?: string }>;
};

export default async function LoginPage({ searchParams }: Props) {
  // 打开登录页就把凭据准备好：密码会立刻打印到日志，
  // 避免"没有密码 → 无法登录 → 密码永远不生成"的死循环。
  await bootstrapAuth();

  const auth = await authenticate();
  if (auth) redirect('/inbox');

  const params = await searchParams;
  const next = typeof params.next === 'string' && params.next.startsWith('/') ? params.next : '/inbox';

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-head">
          <span className="brand-mark" aria-hidden>
            {env.appName.slice(0, 1)}
          </span>
          <span className="login-title">{env.appName}</span>
        </div>
        <p className="login-sub">输入管理员密码。这是一个单用户的自托管实例。</p>

        <LoginForm next={next} />

        <div className="login-foot">
          密码在打开本页时自动生成，并打印到容器日志：
          <br />
          <span className="mono">docker compose logs pb-web | tail -30</span>
          <br />
          也可以提前在 <span className="mono">.env</span> 里设置{' '}
          <span className="mono">ADMIN_PASSWORD</span> 直接指定。
          <br />
          忘记密码：删掉 <span className="mono">data/config/auth.json</span> 后重启，会重新生成。
        </div>
      </div>
    </div>
  );
}
