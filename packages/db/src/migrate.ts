/**
 * 迁移入口：扩展 → drizzle migrations → 函数/向量索引
 *
 * 顺序很重要：001_extensions.sql 必须先跑，否则 item.embedding 的
 * vector(512) 类型不存在，表迁移会失败。
 *
 * 运行：pnpm --filter @pb/db migrate
 */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, '..');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('[migrate] DATABASE_URL 未设置');
  process.exit(1);
}

async function runSqlFile(pool: Pool, relPath: string): Promise<void> {
  const sqlText = await readFile(join(pkgRoot, relPath), 'utf8');
  if (!sqlText.trim()) return;
  await pool.query(sqlText);
  console.log(`[migrate] 已执行 ${relPath}`);
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: url, max: 1 });

  try {
    // 1) 扩展
    await runSqlFile(pool, 'sql/001_extensions.sql');

    // 2) 表结构（drizzle-kit generate 产出）
    const db = drizzle(pool);
    await migrate(db, { migrationsFolder: join(pkgRoot, 'migrations') });
    console.log('[migrate] 表结构迁移完成');

    // 3) 函数索引 / 向量索引
    await runSqlFile(pool, 'sql/002_indexes.sql');

    console.log('[migrate] 全部完成 ✅');
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error('[migrate] 失败:', err);
  process.exit(1);
});
