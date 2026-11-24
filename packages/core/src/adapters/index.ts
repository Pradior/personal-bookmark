/** adapter 注册与降级链（SPEC §6.2） */
import { FetchError } from '../fetcher';
import type { Adapter, CaptureContext, CaptureResult } from './types';
import { wechatAdapter } from './wechat';
import { genericAdapter } from './generic';

/** priority 降序；generic 永远兜底 */
export const adapters: Adapter[] = [wechatAdapter, genericAdapter].sort(
  (a, b) => b.priority - a.priority,
);

export function pickAdapter(url: URL): Adapter {
  return adapters.find((a) => a.match(url)) ?? genericAdapter;
}

/**
 * 依次尝试：命中的 adapter → generic 兜底。
 * 返回 null 表示"连兜底都解析不出正文"，调用方应存成裸链接条目，
 * 而不是让整次采集失败（SPEC §6.2 的底线）。
 */
export async function captureWithFallback(
  ctx: CaptureContext,
): Promise<{ result: CaptureResult | null; tried: string[] }> {
  const primary = pickAdapter(ctx.url);
  const order = primary.id === genericAdapter.id ? [genericAdapter] : [primary, genericAdapter];

  const tried: string[] = [];

  for (const adapter of order) {
    tried.push(adapter.id);
    try {
      const result = await adapter.capture(ctx);
      if (result) return { result, tried };
    } catch (err) {
      // 被人机验证拦住：换 generic 也是同一个 IP，必然同样被拦。
      // 直接抛给上层，让用户看到"需要浏览器里保存"，而不是白等一圈。
      if (err instanceof FetchError && err.kind === 'blocked') throw err;
      // 其余失败继续往下试；兜底也失败就抛出
      if (adapter.id === genericAdapter.id) throw err;
    }
  }

  return { result: null, tried };
}

export { wechatAdapter, genericAdapter };
export type { Adapter, CaptureContext, CaptureResult };
export * from './types';
