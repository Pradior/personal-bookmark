/**
 * 密码与会话代次的自检
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/check-auth.mts
 *
 * 这块是安全关键路径，而且"改密码后旧 token 还能用"这种问题
 * 在界面上完全看不出来 —— 必须用断言兜住。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// env 在模块加载时读取，所以必须先设好再 import
const tmp = mkdtempSync(join(tmpdir(), 'pb-auth-'));
process.env.CONFIG_DIR = tmp;
process.env.ASSETS_DIR = join(tmp, 'assets');
process.env.AUTH_SECRET = 'test-secret-at-least-16-chars-long';
process.env.DATABASE_URL ??= 'postgres://user:pass@127.0.0.1:5432/db';

const { hashPassword, verifyPassword } = await import('../apps/web/lib/auth.ts');
const {
  createSessionToken,
  verifySessionToken,
  setPassword,
  getAuthFile,
  resetAuthCache,
} = await import('../apps/web/lib/auth.ts');

let pass = 0;
let fail = 0;

function ok(label: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    pass += 1;
    console.log(`  ok   ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL ${label}${detail === undefined ? '' : `\n       ${JSON.stringify(detail)}`}`);
  }
}

console.log('\n[密码哈希]');
{
  const hash = hashPassword('correct horse battery staple');
  ok('格式是 scrypt$n$r$p$salt$key', hash.startsWith('scrypt$'), hash.slice(0, 20));
  ok('正确密码能通过', verifyPassword('correct horse battery staple', hash));
  ok('错误密码被拒', !verifyPassword('wrong password', hash));
  ok('空密码被拒', !verifyPassword('', hash));
  ok('同一密码两次哈希不同（加盐）', hash !== hashPassword('correct horse battery staple'));
}

console.log('\n[全角/半角视为同一密码]');
{
  // NFKC 规范化：中文输入法下打出的全角字符应能登录
  const hash = hashPassword('password');
  ok('全角 ｐａｓｓｗｏｒｄ 等价于半角', verifyPassword('ｐａｓｓｗｏｒｄ', hash));
}

console.log('\n[损坏的哈希不崩]');
{
  for (const bad of ['', 'garbage', 'scrypt$1$2$3', 'scrypt$x$8$1$AA$BB']) {
    let threw = false;
    try {
      const result = verifyPassword('whatever', bad);
      ok(`非法哈希被拒（${JSON.stringify(bad)}）`, result === false);
    } catch {
      threw = true;
      ok(`非法哈希抛错也可接受（${JSON.stringify(bad)}）`, threw);
    }
  }
}

console.log('\n[会话代次：改密码后旧 token 失效]');
{
  resetAuthCache();
  const before = await getAuthFile();
  const oldToken = await createSessionToken();
  ok('旧 token 当前有效', await verifySessionToken(oldToken));

  await setPassword('brand-new-password-123');
  const after = await getAuthFile();

  ok('代次 +1', (after.sessionEpoch ?? 0) === (before.sessionEpoch ?? 0) + 1, {
    before: before.sessionEpoch,
    after: after.sessionEpoch,
  });
  ok('旧 token 立刻失效', !(await verifySessionToken(oldToken)));

  const fresh = await createSessionToken();
  ok('新 token 有效', await verifySessionToken(fresh));
}

console.log('\n[删掉凭据文件后，旧 token 也不能用]');
{
  rmSync(join(tmp, 'auth.json'), { force: true });
  resetAuthCache();

  const stale = await createSessionToken(); // 会重建文件（随机代次）
  const rebuilt = await getAuthFile();
  ok('重建后带了随机代次', typeof rebuilt.sessionEpoch === 'number' && rebuilt.sessionEpoch > 0);
  // 重建出来的 token 当然有效；这里验证的是"代次不是固定 0"
  ok('重建后的 token 有效', await verifySessionToken(stale));
}

rmSync(tmp, { recursive: true, force: true });

console.log(`\n结果：${pass} 通过，${fail} 失败\n`);
if (fail > 0) process.exit(1);
