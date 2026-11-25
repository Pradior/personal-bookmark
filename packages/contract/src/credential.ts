import { z } from 'zod';

/**
 * 站点凭据（SPEC 扩展）：某些站点未登录只返回空壳页面，
 * 需要在设置页贴一份登录后的 Cookie。
 *
 * 注意：存的是 Cookie，不是账号密码。账号密码无法用于这类站点
 * （登录要短信/扫码/滑块，且自动登录会触发风控）。
 */
export const CredentialInfo = z.object({
  id: z.string().uuid(),
  domain: z.string(),
  userAgent: z.string().nullable(),
  referer: z.string().nullable(),
  enabled: z.boolean(),
  note: z.string().nullable(),
  /** 只回长度，不回内容 —— 界面里看不到完整 Cookie */
  cookieLength: z.number().int(),
  lastUsedAt: z.string().datetime().nullable(),
  updatedAt: z.string().datetime(),
});
export type CredentialInfo = z.infer<typeof CredentialInfo>;

export const CredentialUpsert = z.object({
  /** 域名，按后缀匹配子域。例如 xiaohongshu.com 会命中 www.xiaohongshu.com */
  domain: z
    .string()
    .min(3)
    .max(200)
    .regex(/^[a-zA-Z0-9.-]+$/, '域名只能包含字母、数字、点和连字符'),
  cookie: z.string().min(10).max(20000),
  userAgent: z.string().max(600).optional(),
  referer: z.string().max(2000).optional(),
  note: z.string().max(200).optional(),
  enabled: z.boolean().default(true),
});
export type CredentialUpsert = z.infer<typeof CredentialUpsert>;
