import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import ReaderFrame from '@/components/ReaderFrame';
import { authenticate } from '@/lib/session';
import { getItem } from '@/lib/items';

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
        <a
          className="btn"
          href={row.url}
          target="_blank"
          rel="noopener noreferrer"
          title="在新窗口打开原文"
        >
          原文 ↗
        </a>
      </header>

      {row.fetchState === 'failed' ? (
        <div className="banner is-warn" style={{ margin: '0 0 16px' }}>
          <div>
            <strong>只保存了链接。</strong>
            {row.fetchError ? ` ${row.fetchError}` : ' 正文没能抓下来。'}
            <br />
            你仍然可以点右上角「原文 ↗」在浏览器里阅读。
          </div>
        </div>
      ) : row.fetchState !== 'done' ? (
        <div className="banner" style={{ margin: '0 0 16px' }}>
          <div>
            <strong>正在处理…</strong> 正文和图片还在下载，稍等片刻刷新本页。
          </div>
        </div>
      ) : null}

      <div className="reader-body">
        {row.contentHtml ? (
          <ReaderFrame html={row.contentHtml} />
        ) : (
          <p className="subtle">还没有正文内容。</p>
        )}
      </div>
    </main>
  );
}
