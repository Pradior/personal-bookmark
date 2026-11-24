import { jsonError } from '@/lib/assetResponse';
import { proxySource } from '@/lib/sourceProxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 「预览原图」：按需回源，流式返回，不落盘 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await ctx.params;
    return await proxySource(id);
  } catch (err) {
    console.error('[assets] source 失败', err);
    return jsonError(500, 'INTERNAL', '获取原图失败');
  }
}
