import AutoRefresh from '@/components/AutoRefresh';
import EmptyState from '@/components/EmptyState';
import ItemCard from '@/components/ItemCard';
import ListPage from '@/components/ListPage';
import SaveBox from '@/components/SaveBox';
import { IconInbox } from '@/components/icons';
import { hasProcessing, listItems } from '@/lib/items';

export const dynamic = 'force-dynamic';

export default async function InboxPage() {
  const items = await listItems({ status: 'inbox' });
  const list = items ?? [];

  return (
    <ListPage title="收件箱" dbReady={items !== null}>
      <AutoRefresh active={hasProcessing(list)} />
      <SaveBox />
      {list.length > 0 ? (
        <div className="cards">
          {list.map((item) => (
            <ItemCard key={item.id} item={item} />
          ))}
        </div>
      ) : (
        <EmptyState
          mark={<IconInbox width={24} height={24} />}
          title="收件箱是空的"
          desc="粘贴一个公众号链接，正文和图片会被抓下来存到本地。"
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
