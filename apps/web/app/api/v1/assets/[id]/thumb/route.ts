import { jsonError, respondWithVariant } from '@/lib/assetResponse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** thumb 变体：列表封面与正文占位 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await ctx.params;
    return await respondWithVariant(id, 'thumb', req);
  } catch (err) {
    console.error('[assets] thumb 失败', err);
    return jsonError(500, 'INTERNAL', '读取缩略图失败');
  }
}
