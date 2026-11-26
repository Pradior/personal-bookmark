import AutoRefresh from '@/components/AutoRefresh';
import EmptyState from '@/components/EmptyState';
import InboxKeyboard from '@/components/InboxKeyboard';
import ItemCard from '@/components/ItemCard';
import ListPage from '@/components/ListPage';
import { IconTag } from '@/components/icons';
import { hasProcessing, listItems } from '@/lib/items';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ name: string }> };

export default async function TagPage({ params }: Props) {
  const { name } = await params;
  const tagName = decodeURIComponent(name);

  const items = await listItems({ status: 'all', tagName });
  const list = items ?? [];

  return (
    <ListPage title={`标签 · ${tagName}`} dbReady={items !== null}>
      <AutoRefresh active={hasProcessing(list)} />
      <InboxKeyboard itemCount={list.length} />
      {list.length > 0 ? (
        <div className="cards">
          {list.map((item) => (
            <ItemCard key={item.id} item={item} />
          ))}
        </div>
      ) : (
        <EmptyState
          mark={<IconTag width={24} height={24} />}
          title={`没有带「${tagName}」的条目`}
          desc="标签可能在刚才被移除了，去「全部条目」看看。"
        />
      )}
    </ListPage>
  );
}
