import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import ItemActions from '@/components/ItemActions';
import ItemTaxonomy from '@/components/ItemTaxonomy';
import ReaderBody from '@/components/ReaderBody';
import RetryButton from '@/components/RetryButton';
import { authenticate } from '@/lib/session';
import { getItem, getNeighbors } from '@/lib/items';
import { listCollections, tagsOf } from '@/lib/taxonomy';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Props = { params: Promise<{ id: string }> };

export default async function ReaderPage({ params }: Props) {
  const auth = await authenticate();
  if (!auth) redirect('/login');

  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const row = await getItem(id).catch(() => null);
  if (!row) notFound();

  // 前后邻居：列表顺序 = savedAt DESC，给 J/K 翻页用
  const neighbors = await getNeighbors(id).catch(() => ({
    prevId: null,
    nextId: null,
    prevTitle: null,
    nextTitle: null,
  }));

  // 分类相关的数据取不到就当空，不影响阅读
  const [collections, tagMap] = await Promise.all([
    listCollections().catch(() => []),
    tagsOf([id]).catch(() => new Map<string, string[]>()),
  ]);
  const itemTags = tagMap.get(id) ?? [];

  const published = row.publishedAt
    ? `${row.publishedAt.getFullYear()}-${String(row.publishedAt.getMonth() + 1).padStart(2, '0')}-${String(
        row.publishedAt.getDate(),
      ).padStart(2, '0')}`
    : null;

  const metaLine = [row.author, row.siteName, published, row.wordCount ? `${row.wordCount} 字` : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <main className="reader-page">
      <header className="reader-topbar">
        <Link href="/inbox" className="btn btn-ghost">
          ← 返回
        </Link>
        <div className="reader-head" style={{ flex: 1, minWidth: 0 }}>
          <h1 className="reader-title">{row.title ?? '（无标题）'}</h1>
          {metaLine ? <div className="reader-meta">{metaLine}</div> : null}
        </div>
        <div className="reader-nav">
          {neighbors.prevId ? (
            <Link
              href={`/item/${neighbors.prevId}`}
              className="btn btn-ghost"
              title={neighbors.prevTitle ?? '上一篇'}
            >
              ↑ 上一篇
            </Link>
          ) : null}
          {neighbors.nextId ? (
            <Link
              href={`/item/${neighbors.nextId}`}
              className="btn btn-ghost"
              title={neighbors.nextTitle ?? '下一篇'}
            >
              下一篇 ↓
            </Link>
          ) : null}
        </div>
        {/* 速记没有来源链接，就不显示「原文 ↗」 */}
        {row.url ? (
          <a
            className="btn"
            href={row.url}
            target="_blank"
            rel="noopener noreferrer"
            title="在新窗口打开原文"
          >
            原文 ↗
          </a>
        ) : null}
        <ItemActions
          variant="reader"
          item={{
            id: row.id,
            status: row.status,
            hasUrl: Boolean(row.url),
            collectionId: row.collectionId,
          }}
        />
      </header>

      {row.fetchState === 'failed' ? (
        <div className="banner is-warn" style={{ margin: '0 0 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 240 }}>
              <strong>只保存了链接。</strong>
              {row.fetchError ? ` ${row.fetchError}` : ' 正文没能抓下来。'}
              <br />
              也可以点右上角「原文 ↗」在浏览器里阅读。
            </div>
            <RetryButton itemId={row.id} />
          </div>
        </div>
      ) : row.fetchState !== 'done' ? (
        <div className="banner" style={{ margin: '0 0 16px' }}>
          <div>
            <strong>正在处理…</strong> 正文和图片还在下载，稍等片刻刷新本页。
          </div>
        </div>
      ) : row.fetchError ? (
        // 抓取"成功"但有警告（图片缺失、只拿到摘要等）—— 把真实原因说出来，
        // 否则用户只看到内容不全却不知道该怎么补
        <div className="banner" style={{ margin: '0 0 16px' }}>
          <div style={{ fontSize: 12.5, lineHeight: 1.6 }}>
            <strong>内容可能不完整：</strong>
            {row.fetchError}
            <br />
            <span className="subtle">
              用浏览器扩展在这个页面再保存一次（勾选「已收藏过则覆盖更新」）可以补全。
            </span>
          </div>
        </div>
      ) : null}

      <ItemTaxonomy
        itemId={row.id}
        tags={itemTags}
        collectionId={row.collectionId}
        collections={collections}
      />

      {row.contentHtml ? (
        <ReaderBody
          itemId={row.id}
          html={row.contentHtml}
          prevId={neighbors.prevId}
          nextId={neighbors.nextId}
          prevTitle={neighbors.prevTitle}
          nextTitle={neighbors.nextTitle}
          sourceUrl={row.url}
        />
      ) : (
        <div className="reader-body">
          <p className="subtle">还没有正文内容。</p>
        </div>
      )}
    </main>
  );
}
