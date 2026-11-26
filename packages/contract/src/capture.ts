import { z } from 'zod';

/* ── 采集请求（SPEC §5.3） ─────────────────────────── */

export const CaptureMode = z.enum(['auto', 'url-only', 'full']);

export const CaptureRequest = z.object({
  /** 原始链接；允许用户粘贴带文案的整段文字，服务端会先抠 URL */
  url: z.string().min(1).max(8192),

  mode: CaptureMode.default('auto'),

  /**
   * 客户端已渲染好的整页 HTML。
   * 这是绕开公众号反爬的正路（ADR-001 实证：服务端抓会被验证码拦）。
   * 上限 4MB —— 超过就只存链接。
   */
  html: z.string().max(4_000_000).optional(),

  /** 已上传的资源 id（Sprint 2 接扩展时用） */
  assetIds: z.array(z.string().uuid()).max(200).optional(),

  /** 客户端的初步判断，服务端会复核 */
  hint: z
    .object({
      title: z.string().max(500).optional(),
      author: z.string().max(200).optional(),
      excerpt: z.string().max(2000).optional(),
      coverUrl: z.string().max(2048).optional(),
      noteHtml: z.string().max(2_000_000).optional(),
    })
    .optional(),

  collectionId: z.string().uuid().optional(),
  tags: z.array(z.string().min(1).max(64)).max(20).optional(),

  /**
   * 命中已存在的条目时，用这次的内容覆盖它（而不是返回 409）。
   *
   * 用途：先前用「粘贴链接」存的小红书条目只有空壳，后来用扩展抓到了完整
   * DOM —— 没有覆盖就只能先删再存，而删除接口很容易误操作。
   * 只在带了 html 时才允许覆盖，避免"只发链接"把已有正文冲掉。
   */
  overwrite: z.boolean().default(false),

  client: z.enum(['extension', 'pwa', 'ios', 'api', 'manual']).default('api'),
});
export type CaptureRequest = z.infer<typeof CaptureRequest>;

export const CaptureResponse = z.object({
  itemId: z.string().uuid(),
  jobId: z.string().nullable(),
  status: z.enum(['queued', 'duplicate']),
  duplicate: z.boolean(),
  existingItemId: z.string().uuid().optional(),
});
export type CaptureResponse = z.infer<typeof CaptureResponse>;
