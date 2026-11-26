/**
 * 关键 SQL 片段
 *
 * 抽出来的原因：这几段是"拼错了只会在真库上炸"的类型，本地没有 Postgres
 * 时完全测不到。抽成纯函数之后可以用 drizzle 的 `.toSQL()` 断言生成的 SQL，
 * 至少在 CI 里挡住参数丢失 / 类型推断失败这类低级错误。
 */
import { sql, type SQL } from 'drizzle-orm';
import { item } from '@pb/db';

/**
 * 带某标签的条目。
 * 用 EXISTS 子查询而不是 join：一个条目有多个标签时 join 会产生重复行，
 * 还得再 DISTINCT 一次。
 */
export function tagExistsFilter(tagName: string): SQL {
  return sql`exists (
    select 1 from item_tag it
    join tag t on t.id = it.tag_id
    where it.item_id = ${item.id} and t.name = ${tagName}
  )`;
}

/**
 * 列表里相对某条的前/后邻居。
 *
 * 必须用 (saved_at, id) 元组比较：只比 saved_at 会在"同一秒存两条"时
 * 卡住不动（时间戳相等 → 永远选不到对方）。
 * 参数带显式 cast，否则行构造器里的占位符类型 Postgres 可能推断不出来。
 */
export function neighborFilter(
  savedAt: Date,
  id: string,
  direction: 'newer' | 'older',
): SQL {
  const op = direction === 'newer' ? sql`>` : sql`<`;
  return sql`(${item.savedAt}, ${item.id}) ${op} (${savedAt}::timestamptz, ${id}::uuid)`;
}
