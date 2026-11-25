/**
 * 站点凭据的加解密与匹配自检
 *
 *   pnpm --filter @pb/core check:credential
 *
 * 这条路径出错是静默的：解密失败 → 抓取不带 Cookie → 又变成空壳页面，
 * 而用户看不出原因。所以必须有断言兜住。
 */
import {
  decryptSecret,
  domainMatches,
  encryptSecret,
  normalizeCookie,
} from '../src/credentialCrypto.ts';

const SECRET = 'test-secret-at-least-16-chars-long';

let pass = 0;
let fail = 0;

function eq(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    pass += 1;
    console.log(`  ok   ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL ${label}\n       实际: ${a}\n       期望: ${e}`);
  }
}

function truthy(label: string, actual: boolean): void {
  if (actual) {
    pass += 1;
    console.log(`  ok   ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL ${label}`);
  }
}

console.log('\n[加解密往返]');
{
  const plain = 'a=1; web_session=abcdef0123456789; x=中文值';
  const cipher = encryptSecret(plain, SECRET);
  eq('密文是三段式', cipher.split('.').length, 3);
  truthy('密文不含明文', !cipher.includes('web_session'));
  eq('解密回原文', decryptSecret(cipher, SECRET), plain);
}
{
  const cipher = encryptSecret('同一个值', SECRET);
  const again = encryptSecret('同一个值', SECRET);
  truthy('每次加密 IV 不同（密文不重复）', cipher !== again);
  eq('但都能解回同一个值', decryptSecret(again, SECRET), '同一个值');
}

console.log('\n[错误密钥 / 篡改]');
{
  const cipher = encryptSecret('secret-cookie-value', SECRET);
  let threw = false;
  try {
    decryptSecret(cipher, 'another-secret-also-long-enough');
  } catch {
    threw = true;
  }
  truthy('换密钥解不开（GCM 校验失败）', threw);
}
{
  const cipher = encryptSecret('secret-cookie-value', SECRET);
  const parts = cipher.split('.');
  // 篡改密文体最后一个字符
  const body = parts[2] as string;
  const tampered = `${parts[0]}.${parts[1]}.${body.slice(0, -1)}${body.endsWith('A') ? 'B' : 'A'}`;
  let threw = false;
  try {
    decryptSecret(tampered, SECRET);
  } catch {
    threw = true;
  }
  truthy('篡改密文会被识别出来', threw);
}
{
  let threw = false;
  try {
    decryptSecret('not-a-ciphertext', SECRET);
  } catch {
    threw = true;
  }
  truthy('格式不对直接报错', threw);
}

console.log('\n[Cookie 规范化]');
eq(
  '去掉 Cookie: 前缀',
  normalizeCookie('Cookie: a=1; b=2'),
  'a=1; b=2',
);
eq(
  '多行折行合并成一行',
  normalizeCookie('a=1;\nb=2;\n\nc=3'),
  'a=1; b=2; c=3',
);
eq(
  '分号后统一补空格',
  normalizeCookie('a=1;b=2;c=3'),
  'a=1; b=2; c=3',
);
eq('首尾空白去掉', normalizeCookie('  a=1  '), 'a=1');

console.log('\n[域名匹配]');
eq('完全相等', domainMatches('xiaohongshu.com', 'xiaohongshu.com'), true);
eq('子域命中主域', domainMatches('www.xiaohongshu.com', 'xiaohongshu.com'), true);
eq('多级子域命中', domainMatches('a.b.xiaohongshu.com', 'xiaohongshu.com'), true);
eq('前缀相似的域名不算命中', domainMatches('evilxiaohongshu.com', 'xiaohongshu.com'), false);
eq('子串出现在中间不算命中', domainMatches('xiaohongshu.com.evil.cn', 'xiaohongshu.com'), false);
eq('大小写无关', domainMatches('WWW.XiaoHongShu.com', 'xiaohongshu.com'), true);
eq('前导点被忽略', domainMatches('www.xiaohongshu.com', '.xiaohongshu.com'), true);

console.log(`\n结果：${pass} 通过，${fail} 失败\n`);
if (fail > 0) process.exit(1);
