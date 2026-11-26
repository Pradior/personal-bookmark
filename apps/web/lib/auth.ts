/**
 * 认证原语（SPEC §5.1）
 *
 * 三件事：
 *   1. 密码哈希 —— 用 node:crypto 的 scrypt，避免引入原生依赖
 *      （SPEC 原写 @node-rs/argon2；Sprint 0 改成 scrypt，理由见 README「与 SPEC 的偏差」）
 *   2. 会话 JWT —— jose 的 HS256，HttpOnly cookie
 *   3. PAT —— 32 字节随机，库里只存 SHA-256 与前缀
 */
import { createHash, randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SignJWT, jwtVerify } from 'jose';
import { env } from './env';

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 64;
const ISSUER = 'personal-bookmark';

/* ── 密码 ─────────────────────────────────────────── */

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password.normalize('NFKC'), salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 64 * 1024 * 1024,
  });
  return [
    'scrypt',
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString('base64'),
    key.toString('base64'),
  ].join('$');
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = Buffer.from(parts[4] ?? '', 'base64');
  const expected = Buffer.from(parts[5] ?? '', 'base64');
  if (!Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p)) return false;
  if (salt.length === 0 || expected.length === 0) return false;

  const actual = scryptSync(password.normalize('NFKC'), salt, expected.length, {
    N: n,
    r,
    p,
    maxmem: 64 * 1024 * 1024,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/* ── auth.json：首启自动生成管理员密码 ────────────── */

export type AuthFile = {
  version: 1;
  passwordHash: string;
  createdAt: string;
  /**
   * 会话代次。改密码时 +1，所有旧 cookie 立即失效。
   *
   * 没有它的话：改密码只换了登录凭据，已经签发的 JWT 还能用 30 天 ——
   * 而改密码最常见的动机恰恰是怀疑 cookie 泄露。
   */
  sessionEpoch?: number;
};

let cachedAuth: AuthFile | null = null;

function authFilePath(): string {
  return join(env.configDir, 'auth.json');
}

async function readAuthFile(): Promise<AuthFile | null> {
  try {
    const raw = await readFile(authFilePath(), 'utf8');
    const parsed = JSON.parse(raw) as AuthFile;
    if (parsed && typeof parsed.passwordHash === 'string' && parsed.passwordHash) {
      return parsed;
    }
  } catch {
    // 不存在或损坏 → 当作没有
  }
  return null;
}

/**
 * 读取凭据文件；不存在则创建（SPEC §10.4）。
 *
 * 密码来源优先级：
 *   1. 已存在的 auth.json
 *   2. 环境变量 ADMIN_PASSWORD（省得翻日志）
 *   3. 随机生成，并打印到日志
 *
 * 注意：这是幂等的，并发首启可能各写一次，单用户场景可接受。
 */
export async function getAuthFile(): Promise<AuthFile> {
  if (cachedAuth) return cachedAuth;

  const existing = await readAuthFile();
  if (existing) {
    cachedAuth = existing;
    return existing;
  }

  const path = authFilePath();
  const fromEnv = env.adminPassword.trim();
  const useEnv = fromEnv.length > 0;
  const password = useEnv ? fromEnv : randomBytes(9).toString('base64url');

  const created: AuthFile = {
    version: 1,
    passwordHash: hashPassword(password),
    createdAt: new Date().toISOString(),
    // 首启就用随机代次：删掉 auth.json 重新生成后，旧 token 自动失效
    sessionEpoch: randomInt(1, 2_000_000_000),
  };

  await mkdir(env.configDir, { recursive: true });
  await writeFile(path, `${JSON.stringify(created, null, 2)}\n`, 'utf8');

  console.log('─'.repeat(56));
  if (useEnv) {
    console.log(`[${env.appShort}] 已使用 .env 中的 ADMIN_PASSWORD 初始化管理员密码。`);
    console.log(`  凭据文件：${path}`);
  } else {
    console.log(`[${env.appShort}] 已生成初始管理员密码（只显示这一次）：`);
    console.log('');
    console.log(`            ${password}`);
    console.log('');
    console.log(`  凭据文件：${path}`);
    console.log('  忘记密码就删掉该文件，重启后会重新生成。');
  }
  console.log('─'.repeat(56));

  cachedAuth = created;
  return created;
}

/**
 * 启动引导：在真正需要密码之前，把凭据文件准备好。
 *
 * 为什么必须存在：密码原来只在"有人尝试登录"时才生成，
 * 而用户恰恰是因为没密码才登不进来 —— 死循环。（2026-11-24 真实踩过）
 *
 * 为什么不用 instrumentation.ts：Next 会把 instrumentation 同时打进
 * Edge 运行时，而这里用到 node:fs，构建期直接报 UnhandledSchemeError。
 * 所以放在登录页渲染时调用 —— 用户第一步必然打开它。
 */
let bootstrapped = false;

export async function bootstrapAuth(): Promise<void> {
  if (bootstrapped) return;

  const path = authFilePath();
  const existed = (await readAuthFile()) !== null;

  await getAuthFile();
  bootstrapped = true;

  if (existed) {
    console.log(`[${env.appShort}] 凭据已就绪：${path}`);
    console.log(`[${env.appShort}] 忘记密码：删除该文件后重启，会重新生成。`);
  }
  // 新建分支的日志由 getAuthFile 负责，这里不重复
}

/** 仅供测试/诊断：清掉内存缓存 */
export function resetAuthCache(): void {
  cachedAuth = null;
}

/* ── 会话 JWT ─────────────────────────────────────── */

function sessionSecret(): Uint8Array {
  if (env.authSecret.length < 16) {
    throw new Error(
      '[pb] AUTH_SECRET 未设置或过短（至少 16 字符）。生成：openssl rand -base64 32',
    );
  }
  return new TextEncoder().encode(env.authSecret);
}

export async function createSessionToken(): Promise<string> {
  const auth = await getAuthFile();
  return new SignJWT({ sub: 'owner', ep: auth.sessionEpoch ?? 0 })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(ISSUER)
    .setExpirationTime(`${env.sessionDays}d`)
    .sign(sessionSecret());
}

export async function verifySessionToken(token: string): Promise<boolean> {
  try {
    const { payload } = await jwtVerify(token, sessionSecret(), {
      issuer: ISSUER,
      audience: ISSUER,
    });
    if (payload.sub !== 'owner') return false;

    // 代次对不上 = 改过密码（或凭据文件被重建），旧 token 一律作废。
    // 没有 ep 声明的是本次升级之前签发的，同样作废，强制重新登录一次。
    const auth = await getAuthFile();
    return payload.ep === (auth.sessionEpoch ?? 0);
  } catch {
    return false;
  }
}

/**
 * 修改管理员密码。
 *
 * 会把 sessionEpoch +1，于是**所有已签发的会话立刻失效**（包括调用者自己），
 * 调用方应引导用户用新密码重新登录。这是刻意的：改密码最常见的动机
 * 是怀疑凭据泄露，如果旧 cookie 还能继续用，这个操作就白做了。
 */
export async function setPassword(newPassword: string): Promise<void> {
  const current = await getAuthFile();
  const next: AuthFile = {
    version: 1,
    passwordHash: hashPassword(newPassword),
    createdAt: current.createdAt,
    sessionEpoch: (current.sessionEpoch ?? 0) + 1,
  };

  await mkdir(env.configDir, { recursive: true });
  await writeFile(authFilePath(), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  cachedAuth = next;

  console.log(`[${env.appShort}] 管理员密码已更新，所有旧会话已失效。`);
}

/* ── PAT ──────────────────────────────────────────── */

export const PAT_PREFIX = 'pb_';

export function hashPat(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export type GeneratedPat = { token: string; hash: string; prefix: string };

export function generatePat(): GeneratedPat {
  const body = randomBytes(32).toString('base64url');
  const token = `${PAT_PREFIX}${body}`;
  return {
    token,
    hash: hashPat(token),
    // 前 12 字符用于在列表里辨认（含 pb_ 前缀）
    prefix: token.slice(0, 12),
  };
}

export function looksLikePat(value: string): boolean {
  return value.startsWith(PAT_PREFIX) && value.length > 20;
}
