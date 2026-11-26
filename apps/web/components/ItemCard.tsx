'use client';

import Link from 'next/link';
import type { ItemSummary } from '@pb/contract';
import ItemActions from './ItemActions';

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

export default function ItemCard({
  item,
  selected,
  onToggle,
}: {
  item: ItemSummary;
  /** 传了 onToggle 才显示勾选框 */
  selected?: boolean;
  onToggle?: (id: string, next: boolean) => void;
}) {
  const processing = item.fetchState !== 'done' && item.fetchState !== 'failed';
  const failed = item.fetchState === 'failed';
  const read = item.status === 'archived';
  const selectable = Boolean(onToggle);

  return (
    /**
     * 外层用 div 而不是把菜单塞进 Link：
     * <button> 不能作为 <a> 的后代（HTML 非法），而且点击会冒泡触发跳转。
     * 所以勾选框与菜单都作为兄弟节点绝对定位。
     */
    <div
      className={`card-wrap${selected ? ' is-selected' : ''}`}
      data-item-id={item.id}
      // 键盘流（InboxKeyboard）据此定位卡片、取原文地址
      data-item-url={item.url ?? ''}
    >
      {selectable ? (
        <label className="card-check" title="选中">
          <input
            type="checkbox"
            checked={Boolean(selected)}
            onChange={(e) => onToggle?.(item.id, e.target.checked)}
            aria-label="选中条目"
          />
        </label>
      ) : null}
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
          ) : (
            <>
              {item.excerpt ? <div className="card-excerpt">{item.excerpt}</div> : null}
              {/* 抓取成功但有警告（例如图片没抓到、只拿到 meta）时给个提示，
                  否则用户只会觉得"为什么没图" */}
              {item.fetchError ? (
                <div className="card-note subtle" title={item.fetchError}>
                  ⚠ 内容不完整
                </div>
              ) : null}
            </>
          )}

          <div className="card-meta">
            <span>{SOURCE_LABEL[item.source] ?? item.source}</span>
            {item.siteName && item.source !== 'wechat' ? <span>{item.siteName}</span> : null}
            <span>{relativeTime(item.savedAt)}</span>
            {item.wordCount > 0 ? <span>{item.wordCount} 字</span> : null}
          </div>

          {item.tags.length > 0 ? (
            <div className="card-tags">
              {item.tags.slice(0, 4).map((t) => (
                <span className="tag is-small" key={t}>
                  {t}
                </span>
              ))}
              {item.tags.length > 4 ? (
                <span className="subtle" style={{ fontSize: 11 }}>
                  +{item.tags.length - 4}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
        </article>
      </Link>

      <ItemActions
        variant="card"
        item={{
          id: item.id,
          status: item.status,
          hasUrl: Boolean(item.url),
          collectionId: item.collectionId,
        }}
      />
    </div>
  );
}
