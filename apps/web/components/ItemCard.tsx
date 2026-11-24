import Link from 'next/link';
import type { ItemSummary } from '@pb/contract';

const SOURCE_LABEL: Record<string, string> = {
  wechat: '公众号',
  xhs: '小红书',
  douyin: '抖音',
  web: '网页',
  manual: '速记',
};

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const min = Math.round(diff / 60_000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hour = Math.round(min / 60);
  if (hour < 24) return `${hour} 小时前`;
  const day = Math.round(hour / 24);
  if (day < 30) return `${day} 天前`;
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

const PROCESSING_LABEL: Record<string, string> = {
  queued: '排队中…',
  fetching: '正在抓取正文…',
  assets: '正在下载图片…',
};

export default function ItemCard({ item }: { item: ItemSummary }) {
  const processing = item.fetchState !== 'done' && item.fetchState !== 'failed';
  const failed = item.fetchState === 'failed';
  const read = item.status === 'archived';

  return (
    <Link href={`/item/${item.id}`} className="card-link">
      <article className="card">
        <div className="card-cover">
          {item.coverAssetId ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={`/api/v1/assets/${item.coverAssetId}/thumb`} alt="" loading="lazy" />
          ) : (
            <div className="card-cover-empty">{SOURCE_LABEL[item.source] ?? '—'}</div>
          )}
        </div>

        <div style={{ minWidth: 0 }}>
          <div className="card-title" style={read ? { opacity: 0.55 } : undefined}>
            {item.title ?? (processing ? PROCESSING_LABEL[item.fetchState] : '（无标题）')}
          </div>

          {failed ? (
            <div className="card-note is-error">⚠ {item.fetchError ?? '抓取失败'}</div>
          ) : processing ? (
            <div className="card-note is-working">{PROCESSING_LABEL[item.fetchState]}</div>
          ) : item.excerpt ? (
            <div className="card-excerpt">{item.excerpt}</div>
          ) : null}

          <div className="card-meta">
            <span>{SOURCE_LABEL[item.source] ?? item.source}</span>
            {item.siteName && item.source !== 'wechat' ? <span>{item.siteName}</span> : null}
            <span>{relativeTime(item.savedAt)}</span>
            {item.wordCount > 0 ? <span>{item.wordCount} 字</span> : null}
          </div>
        </div>
      </article>
    </Link>
  );
}
