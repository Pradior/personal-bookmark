import { z } from 'zod';

/* ── 登录（SPEC §5.1） ─────────────────────────────── */

export const LoginRequest = z.object({
  password: z.string().min(1).max(512),
});
export type LoginRequest = z.infer<typeof LoginRequest>;

export const AuthMe = z.object({
  authenticated: z.literal(true),
  /** 由 auth.json 决定，单用户固定为 'owner' */
  user: z.literal('owner'),
  authMethod: z.enum(['session', 'pat']),
});
export type AuthMe = z.infer<typeof AuthMe>;

/* ── 访问令牌（PAT） ───────────────────────────────── */

/**
 * 令牌明文形如 pb_<32 字节 base62>。
 * 库里只存 SHA-256 与 12 字符前缀（便于用户在列表中认出是哪一把）。
 */
export const TokenCreateRequest = z.object({
  name: z.string().min(1).max(80),
  scopes: z.array(z.enum(['capture', 'read', 'write'])).min(1).default(['capture', 'read']),
  /** 不填则永不过期 */
  expiresInDays: z.number().int().min(1).max(3650).optional(),
});
export type TokenCreateRequest = z.infer<typeof TokenCreateRequest>;

export const TokenInfo = z.object({
  id: z.string().uuid(),
  name: z.string(),
  prefix: z.string(),
  scopes: z.array(z.string()),
  lastUsedAt: z.string().datetime().nullable(),
  expiresAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type TokenInfo = z.infer<typeof TokenInfo>;

/** 创建时返回一次明文，之后无法再取回 */
export const TokenCreated = TokenInfo.extend({
  token: z.string(),
});
export type TokenCreated = z.infer<typeof TokenCreated>;

export const TOKEN_PREFIX = 'pb_';
