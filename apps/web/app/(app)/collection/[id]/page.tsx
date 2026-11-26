import { notFound } from 'next/navigation';
import AutoRefresh from '@/components/AutoRefresh';
import EmptyState from '@/components/EmptyState';
import InboxKeyboard from '@/components/InboxKeyboard';
import ItemCard from '@/components/ItemCard';
import ListPage from '@/components/ListPage';
import { IconFolder } from '@/components/icons';
import { hasProcessing, listItems } from '@/lib/items';
import { listCollections } from '@/lib/taxonomy';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Props = { params: Promise<{ id: string }> };

export default async function CollectionPage({ params }: Props) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const collections = await listCollections().catch(() => []);
  const target = collections.find((c) => c.id === id);
  if (!target) notFound();

  const items = await listItems({ status: 'all', collectionId: id });
  const list = items ?? [];

  return (
    <ListPage title={`集合 · ${target.name}`} dbReady={items !== null}>
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
          mark={<IconFolder width={24} height={24} />}
          title={`「${target.name}」还没有条目`}
          desc="打开任意条目，在顶部的「集合」下拉里选它即可归类。"
        />
      )}
    </ListPage>
  );
}
