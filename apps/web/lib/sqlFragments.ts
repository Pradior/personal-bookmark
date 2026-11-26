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
 * 关键词搜索：FTS 与子串匹配取并集。
 *
 * 两条路都要，因为各覆盖一半场景：
 *   - FTS（search_text 是 jieba 预分词结果）对中文分词准，但**速记的
 *     search_text 是空的**（web 侧没有 jieba），所以速记只能靠子串匹配
 *   - trigram/ILIKE 能命中任意子串，但大正文上慢；有 gin_trgm_ops 索引兜着
 * 用 OR 合并而不是二选一，是为了"宁多不漏"——搜不到比搜出几条无关的更糟。
 */
export function searchFilter(keyword: string): SQL {
  const raw = keyword.trim().slice(0, 200);
  // ILIKE 的通配符要转义，否则用户输入 % 就变成全表匹配
  const escaped = raw.replace(/[\\%_]/g, (ch) => `\\${ch}`);
  const pattern = `%${escaped}%`;

  return sql`(
    (${item.searchText} <> '' and to_tsvector('simple', ${item.searchText}) @@ plainto_tsquery('simple', ${raw}))
    or ${item.title} ilike ${pattern}
    or ${item.contentText} ilike ${pattern}
    or ${item.excerpt} ilike ${pattern}
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
