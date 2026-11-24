import EmptyState from '@/components/EmptyState';
import ItemCard from '@/components/ItemCard';
import ListPage from '@/components/ListPage';
import { IconLayers } from '@/components/icons';
import { listItems } from '@/lib/items';

export const dynamic = 'force-dynamic';

export default async function AllItemsPage() {
  const items = await listItems({ status: 'all' });
  const list = items ?? [];

  return (
    <ListPage title="全部条目" dbReady={items !== null}>
      {list.length > 0 ? (
        <div className="cards">
          {list.map((item) => (
            <ItemCard key={item.id} item={item} />
          ))}
        </div>
      ) : (
        <EmptyState
          mark={<IconLayers width={24} height={24} />}
          title="还没有任何条目"
          desc="所有保存过的内容都会出现在这里，包括已归档的。"
          hint={<span>公众号、小红书、抖音、速记，都在这一个列表里</span>}
        />
      )}
    </ListPage>
  );
}
