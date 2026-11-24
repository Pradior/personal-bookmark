import EmptyState from '@/components/EmptyState';
import ItemCard from '@/components/ItemCard';
import ListPage from '@/components/ListPage';
import { IconBookOpen } from '@/components/icons';
import { listItems } from '@/lib/items';

export const dynamic = 'force-dynamic';

export default async function ReadingPage() {
  const items = await listItems({ status: 'reading' });
  const list = items ?? [];

  return (
    <ListPage title="待读" dbReady={items !== null}>
      {list.length > 0 ? (
        <div className="cards">
          {list.map((item) => (
            <ItemCard key={item.id} item={item} />
          ))}
        </div>
      ) : (
        <EmptyState
          mark={<IconBookOpen width={24} height={24} />}
          title="还没有在读的内容"
          desc="已经开读但没读完的条目会留在这里，方便接着读。"
          hint={<span>阅读进度会在 Sprint 4 接上</span>}
        />
      )}
    </ListPage>
  );
}
