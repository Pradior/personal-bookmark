/** Adapter 契约（SPEC §6.1） */

export type PlatformId = 'wechat' | 'xhs' | 'douyin' | 'web';

export type CaptureImage = {
  /** 在 contentHtml 里用 data-pb-img="key" 占位 */
  key: string;
  url: string;
  referer?: string;
  userAgent?: string;
};

export type CaptureResult = {
  type: 'article' | 'note' | 'image' | 'video' | 'link';
  source: 'wechat' | 'xhs' | 'douyin' | 'web' | 'manual';
  title?: string;
  author?: string;
  siteName?: string;
  excerpt?: string;

  /** 图片仍是 data-pb-img 占位符，下载完再替换成 /api/v1/assets/:id */
  contentHtml: string;
  contentText: string;

  publishedAt?: Date;
  coverUrl?: string;
  coverReferer?: string;

  images: CaptureImage[];

  /** 原始报文，进 snapshot 表（解析器升级后可重跑） */
  rawSnapshot?: string;

  meta: Record<string, unknown>;
  warnings: string[];
};

export type CaptureContext = {
  url: URL;
  /** 客户端送上来的整页 HTML（扩展/PWA）；为空则 adapter 自己抓 */
  html?: string;
  referer?: string;
  userAgent?: string;
  timeoutMs?: number;
  maxBytes?: number;
};

export type Adapter = {
  id: string;
  priority: number;
  match(url: URL): boolean;
  /**
   * 返回 null 表示"这个 adapter 认领了 URL 但解析不出正文"，
   * 调用方应降级到 generic 兜底（SPEC §6.2）。
   */
  capture(ctx: CaptureContext): Promise<CaptureResult | null>;
};

/** 从 HTML 里粗略估字数（中文按字，英文按词） */
export function countWords(text: string): number {
  const cjk = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z0-9]+/g) ?? []).length;
  return cjk + latin;
}
