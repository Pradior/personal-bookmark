import AutoRefresh from '@/components/AutoRefresh';
import EmptyState from '@/components/EmptyState';
import InboxKeyboard from '@/components/InboxKeyboard';
import ItemList from '@/components/ItemList';
import ListPage from '@/components/ListPage';
import SaveBox from '@/components/SaveBox';
import { IconInbox } from '@/components/icons';
import { hasProcessing, listItems } from '@/lib/items';
import { listCollections } from '@/lib/taxonomy';

export const dynamic = 'force-dynamic';

const SOURCE_TABS = [
  { key: 'all', label: '全部' },
  { key: 'wechat', label: '公众号' },
  { key: 'xhs', label: '小红书' },
  { key: 'douyin', label: '抖音' },
  { key: 'web', label: '网页' },
  { key: 'manual', label: '速记' },
] as const;

type SourceKey = Exclude<(typeof SOURCE_TABS)[number]['key'], 'all'>;

type Props = { searchParams: Promise<{ source?: string }> };

export default async function InboxPage({ searchParams }: Props) {
  const params = await searchParams;
  const raw = params.source ?? '';
  const matched = SOURCE_TABS.find((t) => t.key === raw);
  const source: SourceKey | undefined =
    matched && matched.key !== 'all' ? (matched.key as SourceKey) : undefined;

  const [items, collections] = await Promise.all([
    listItems({ status: 'inbox', source }),
    listCollections().catch(() => []),
  ]);
  const list = items ?? [];

  return (
    <ListPage title="收件箱" dbReady={items !== null}>
      <AutoRefresh active={hasProcessing(list)} />
      <InboxKeyboard itemCount={list.length} />
      <SaveBox />

      <div className="filter-tabs" role="tablist" aria-label="按来源筛选">
        {SOURCE_TABS.map((t) => {
          const active = t.key === (source ?? 'all');
          const href = t.key === 'all' ? '/inbox' : `/inbox?source=${t.key}`;
          return (
            <a
              key={t.key}
              href={href}
              className={`filter-tab${active ? ' is-active' : ''}`}
              role="tab"
              aria-selected={active}
            >
              {t.label}
            </a>
          );
        })}
      </div>

      {list.length > 0 ? (
        <ItemList items={list} mode="inbox" collections={collections} />
      ) : (
        <EmptyState
          mark={<IconInbox width={24} height={24} />}
          title={source ? '这个来源下还没有条目' : '收件箱是空的'}
          desc={
            source
              ? '换个来源看看，或者把链接粘到上面的输入框。'
              : '粘贴一个公众号链接，正文和图片会被抓下来存到本地。'
          }
          hint={
            <>
              <span className="kbd">Ctrl</span>
              <span className="kbd">V</span>
              <span>粘到上面的输入框</span>
            </>
          }
        />
      )}
    </ListPage>
  );
}
