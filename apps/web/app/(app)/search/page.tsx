import AutoRefresh from '@/components/AutoRefresh';
import EmptyState from '@/components/EmptyState';
import InboxKeyboard from '@/components/InboxKeyboard';
import ItemList from '@/components/ItemList';
import ListPage from '@/components/ListPage';
import { IconSearch } from '@/components/icons';
import { hasProcessing, listItems } from '@/lib/items';

export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<{ q?: string }> };

export default async function SearchPage({ searchParams }: Props) {
  const { q } = await searchParams;
  const keyword = (q ?? '').trim().slice(0, 200);

  const items = keyword ? await listItems({ status: 'all', search: keyword, limit: 100 }) : [];
  const list = items ?? [];

  return (
    <ListPage title={keyword ? `搜索 · ${keyword}` : '搜索'} dbReady={items !== null}>
      <AutoRefresh active={hasProcessing(list)} />
      <InboxKeyboard itemCount={list.length} />

      <div className="banner" style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 12.5, lineHeight: 1.6 }}>
          搜索范围：标题、正文、摘要。中文按子串匹配（不依赖分词），所以「面包超人」也能命中
          「面包超人的新单元」。不含回收站。
        </div>
      </div>

      {!keyword ? (
        <EmptyState
          mark={<IconSearch width={24} height={24} />}
          title="输入关键词开始搜索"
          desc="在顶部搜索框里输入，回车即可。"
        />
      ) : list.length > 0 ? (
        <ItemList items={list} mode="browse" />
      ) : (
        <EmptyState
          mark={<IconSearch width={24} height={24} />}
          title={`没有找到「${keyword}」`}
          desc="换个说法试试，或者确认这条内容是否还在收件箱里。"
        />
      )}
    </ListPage>
  );
}
