/**
 * 站点凭据的加解密
 *
 * 存的是 Cookie，不是账号密码。用 AUTH_SECRET 派生密钥做
 * AES-256-GCM —— 数据库被 dump 时不至于直接把登录态交出去。
 * 注意：这不是"零信任"方案，能读到 AUTH_SECRET 的人仍能解密，
 * 只是把风险从"明文躺在库里"降到"需要额外拿到密钥"。
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

function deriveKey(secret: string): Buffer {
  if (!secret || secret.length < 16) {
    throw new Error('AUTH_SECRET 缺失或过短，无法加密站点凭据');
  }
  return createHash('sha256').update(secret, 'utf8').digest();
}

/** 返回 `iv.tag.cipher`（三段 base64url） */
export function encryptSecret(plain: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((b) => b.toString('base64url')).join('.');
}

export function decryptSecret(payload: string, secret: string): string {
  const parts = payload.split('.');
  if (parts.length !== 3) throw new Error('密文格式不正确');
  const [iv, tag, data] = parts as [string, string, string];

  const decipher = createDecipheriv(
    'aes-256-gcm',
    deriveKey(secret),
    Buffer.from(iv, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(data, 'base64url')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

/**
 * 把用户在浏览器里复制的那坨 Cookie 规范化。
 * 允许粘贴成：
 *   a=1; b=2
 *   Cookie: a=1; b=2
 * 也顺手去掉换行和多余空格。
 */
export function normalizeCookie(input: string): string {
  return input
    .replace(/^\s*cookie\s*:\s*/i, '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s*;\s*/g, '; ')
    .trim();
}

/** 判断 host 是否属于某个域名（含子域） */
export function domainMatches(host: string, domain: string): boolean {
  const h = host.toLowerCase();
  const d = domain.toLowerCase().replace(/^\./, '');
  return h === d || h.endsWith(`.${d}`);
}
