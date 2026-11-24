import { jsonError, respondWithVariant } from '@/lib/assetResponse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** display 变体：正文内联图 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await ctx.params;
    return await respondWithVariant(id, 'display', req);
  } catch (err) {
    console.error('[assets] display 失败', err);
    return jsonError(500, 'INTERNAL', '读取资源失败');
  }
}
