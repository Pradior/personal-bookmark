import EmptyState from '@/components/EmptyState';
import InboxKeyboard from '@/components/InboxKeyboard';
import ItemList from '@/components/ItemList';
import ListPage from '@/components/ListPage';
import { IconTrash } from '@/components/icons';
import { listItems } from '@/lib/items';

export const dynamic = 'force-dynamic';

/**
 * 回收站
 *
 * 删除默认是软删（status='trashed'），所以这里列出来的条目
 * 图片和正文都还在——恢复是零成本的。
 * 只有「彻底删除」才真的删行与磁盘文件，且要二次确认。
 */
export default async function TrashPage() {
  const items = await listItems({ status: 'trashed', limit: 200 });
  const list = items ?? [];

  return (
    <ListPage title="回收站" dbReady={items !== null}>
      <InboxKeyboard itemCount={list.length} />

      <div className="banner" role="note" style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 12.5, lineHeight: 1.6 }}>
          回收站里的条目还能正常打开、恢复。点「彻底删除」才会连图片一起清掉，
          <strong>不可恢复</strong>。
        </div>
      </div>

      {list.length > 0 ? (
        <ItemList items={list} mode="trash" />
      ) : (
        <EmptyState
          mark={<IconTrash width={24} height={24} />}
          title="回收站是空的"
          desc="在收件箱里删除的条目会先到这里，误删了可以恢复。"
        />
      )}
    </ListPage>
  );
}
