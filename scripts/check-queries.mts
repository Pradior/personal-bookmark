/**
 * SQL 片段自检
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/check-queries.mts
 *
 * 本地没有 Postgres，所以测不了执行结果。但可以测**生成的 SQL**：
 * 参数有没有丢、cast 有没有写、占位符数量对不对。这几类错误以前
 * 都是推到 NAS 上才发现。
 */
import { sql, type SQL } from 'drizzle-orm';

// getDb 只在执行时才连库，构造查询不会建立连接；给个假 URL 即可
process.env.DATABASE_URL ??= 'postgres://user:pass@127.0.0.1:5432/db';

const { getDb, item } = await import('@pb/db');
const { neighborFilter, searchFilter, tagExistsFilter } = await import(
  '../apps/web/lib/sqlFragments.ts'
);

const db = getDb();

let pass = 0;
let fail = 0;

function ok(label: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    pass += 1;
    console.log(`  ok   ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL ${label}${detail === undefined ? '' : `\n       ${JSON.stringify(detail)}`}`);
  }
}

function sqlOf(fragment: SQL): { sql: string; params: unknown[] } {
  const compiled = db.select({ id: item.id }).from(item).where(fragment).toSQL();
  return { sql: compiled.sql, params: [...compiled.params] };
}

console.log('\n[标签过滤：EXISTS 子查询]');
{
  const { sql: text, params } = sqlOf(tagExistsFilter('技术'));
  ok('用了 exists 子查询', /exists \(/i.test(text), text);
  ok('关联到 item_tag', text.includes('item_tag'));
  ok('关联到 tag 表', /\btag\b/.test(text));
  ok('标签名作为参数传入（不是拼进 SQL）', params.includes('技术'), params);
  ok('没有未定义参数', !text.includes('undefined') && !params.some((p) => p === undefined));
}

console.log('\n[标签名带引号也不会破坏 SQL]');
{
  const nasty = "x'; drop table item; --";
  const { sql: text, params } = sqlOf(tagExistsFilter(nasty));
  ok('恶意字符串作为参数传', params.includes(nasty), params);
  ok('没有拼进 SQL 文本', !text.includes('drop table'), text);
}

console.log('\n[邻居：元组比较]');
{
  const at = new Date('2026-01-02T03:04:05Z');
  const id = '11111111-2222-3333-4444-555555555555';

  const newer = sqlOf(neighborFilter(at, id, 'newer'));
  ok('newer 用 >', newer.sql.includes('>'), newer.sql);
  ok('saved_at 带 timestamptz cast', newer.sql.includes('::timestamptz'), newer.sql);
  ok('id 带 uuid cast', newer.sql.includes('::uuid'), newer.sql);
  ok('时间作为参数', newer.params.some((p) => p instanceof Date), newer.params);
  ok('id 作为参数', newer.params.includes(id), newer.params);

  const older = sqlOf(neighborFilter(at, id, 'older'));
  ok('older 用 <', older.sql.includes('<'), older.sql);
  ok('两边参数个数一致', older.params.length === newer.params.length, {
    newer: newer.params.length,
    older: older.params.length,
  });
}

console.log('\n[搜索：FTS 与子串取并集]');
{
  const { sql: text, params } = sqlOf(searchFilter('面包超人'));

  ok('用了 to_tsvector', /to_tsvector/i.test(text), text);
  ok('用了 plainto_tsquery', /plainto_tsquery/i.test(text), text);
  ok('标题参与 ILIKE', /"title" ilike/i.test(text), text);
  ok('正文参与 ILIKE', /"content_text" ilike/i.test(text), text);
  ok('摘要参与 ILIKE', /"excerpt" ilike/i.test(text), text);
  ok('三个条件用 OR 连起来（宁多不漏）', (text.match(/ or /gi) ?? []).length >= 3, text);
  ok('关键词作为参数传入', params.includes('面包超人'), params);
  ok('ILIKE 的模式带 % 通配', params.some((p) => typeof p === 'string' && p.startsWith('%')), params);
}

console.log('\n[搜索：通配符要转义]');
{
  const { params } = sqlOf(searchFilter('100%_done'));
  const pattern = params.find((p) => typeof p === 'string' && p.startsWith('%')) as string;
  ok('百分号被转义', pattern.includes('\\%'), pattern);
  ok('下划线被转义', pattern.includes('\\_'), pattern);
}

console.log('\n[搜索：空关键词不该被调用]');
{
  // 调用方（listItems）保证只在 trim 后非空时才加这个条件；
  // 这里只确认它不会把空串悄悄变成全表匹配
  const { params } = sqlOf(searchFilter('   '));
  ok('trim 后为空也至少传一个参数', params.length > 0, params);
}

console.log(`\n结果：${pass} 通过，${fail} 失败\n`);
if (fail > 0) process.exit(1);
