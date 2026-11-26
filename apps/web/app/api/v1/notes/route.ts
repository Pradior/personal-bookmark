import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb, item } from '@pb/db';
import { authenticate } from '@/lib/session';
import { ApiError, jsonError } from '@/lib/api';
import { ingestUpload, MAX_UPLOAD_BYTES, MAX_UPLOAD_COUNT } from '@/lib/noteAssets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 首行当标题；太长就截断 */
function titleFromText(text: string): string | null {
  const firstLine = text
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!firstLine) return null;
  return firstLine.length > 80 ? `${firstLine.slice(0, 80)}…` : firstLine;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 纯文本 → 段落 HTML（换行分段，空行忽略） */
function textToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split('\n').map((l) => escapeHtml(l.trim()));
      return `<p>${lines.join('<br />')}</p>`;
    })
    .join('\n');
}

/** 中文按字算、英文按词算，跟 worker 的口径大致一致 */
function countWords(text: string): number {
  const cjk = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) ?? []).length;
  const latin = (text.replace(/[\u4e00-\u9fff\u3400-\u4dbf]/g, ' ').match(/[A-Za-z0-9]+/g) ?? [])
    .length;
  return cjk + latin;
}

/**
 * 创建文字/图片速记（不走网络抓取）。
 *
 * multipart/form-data:
 *   text    纯文本，可空（只贴图片也行）
 *   images  0–9 个文件
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const auth = await authenticate(req);
    if (!auth) throw new ApiError(401, 'UNAUTHORIZED', '未登录');
    if (!auth.scopes.includes('write')) {
      throw new ApiError(403, 'FORBIDDEN', '该令牌无写入权限');
    }

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      throw new ApiError(400, 'BAD_REQUEST', '请求体应为 multipart/form-data');
    }

    const text = String(form.get('text') ?? '').trim();
    const files = form
      .getAll('images')
      .filter((v): v is File => typeof v === 'object' && v !== null && 'arrayBuffer' in v);

    if (text.length === 0 && files.length === 0) {
      throw new ApiError(400, 'BAD_REQUEST', '速记内容为空：写点文字或贴张图');
    }
    if (text.length > 100_000) {
      throw new ApiError(400, 'BAD_REQUEST', '文字太长了（上限 10 万字）');
    }
    if (files.length > MAX_UPLOAD_COUNT) {
      throw new ApiError(400, 'BAD_REQUEST', `最多 ${MAX_UPLOAD_COUNT} 张图`);
    }

    const db = getDb();

    // 先建条目：图片的 asset 需要 itemId（外键 + cascade 清理）
    const [created] = await db
      .insert(item)
      .values({
        type: 'note',
        source: 'manual',
        status: 'inbox',
        url: null,
        canonicalUrl: null,
        title: titleFromText(text) ?? '未命名速记',
        siteName: '速记',
        excerpt: text.slice(0, 200) || null,
        fetchState: 'done',
        fetchedAt: new Date(),
        meta: { client: 'pwa', kind: 'note' },
      })
      .returning({ id: item.id });

    if (!created) throw new ApiError(500, 'INTERNAL', '创建速记失败');
    const itemId = created.id;

    // 逐张处理，单张失败不影响整条
    const imageParts: string[] = [];
    const failures: { name: string; reason: string }[] = [];
    let coverAssetId: string | null = null;
    let wordCount = countWords(text);

    for (const file of files) {
      const name = file.name || 'image';
      try {
        if (file.size > MAX_UPLOAD_BYTES) {
          failures.push({ name, reason: '超过 15MB' });
          continue;
        }
        const buffer = Buffer.from(await file.arrayBuffer());
        const ingested = await ingestUpload(db, itemId, { buffer, name });
        if (!ingested) {
          failures.push({ name, reason: '处理失败' });
          continue;
        }
        if (!coverAssetId) coverAssetId = ingested.assetId;
        imageParts.push(
          `<p><img src="/api/v1/assets/${ingested.assetId}"${
            ingested.width && ingested.height
              ? ` width="${ingested.width}" height="${ingested.height}"`
              : ''
          } alt="" /></p>`,
        );
      } catch (err) {
        failures.push({ name, reason: err instanceof Error ? err.message : '未知错误' });
      }
    }

    const contentHtml = [textToHtml(text), ...imageParts].filter(Boolean).join('\n');
    const contentText = text;

    await db
      .update(item)
      .set({
        contentHtml,
        contentText,
        wordCount,
        coverAssetId,
        updatedAt: new Date(),
        meta: {
          client: 'pwa',
          kind: 'note',
          imageCount: imageParts.length,
          ...(failures.length ? { uploadFailures: failures } : {}),
        },
      })
      .where(eq(item.id, itemId));

    return NextResponse.json(
      {
        itemId,
        imageCount: imageParts.length,
        failures,
      },
      { status: 201 },
    );
  } catch (err) {
    return jsonError(err);
  }
}
