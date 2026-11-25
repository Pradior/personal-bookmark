/**
 * Worker 入口
 *
 * 队列用 pg-boss（ADR-006），队列表就放在同一个 Postgres 里，不需要 Redis。
 * Sprint 1 只接了 capture；assets / clean / index / embed / classify 由
 * capture 任务内部串起来，独立队列留到需要重跑时再拆。
 */
import { Pool } from 'pg';
import PgBoss from 'pg-boss';
import { getDb } from '@pb/db';
import { runCapture, type CaptureJobData } from './jobs/capture';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('[worker] DATABASE_URL 未设置');
  process.exit(1);
}

const APP_SHORT = process.env.APP_SHORT ?? 'pb';

const env = {
  assetsDir: process.env.ASSETS_DIR ?? './data/assets',
  /** 解密站点凭据用；与 web 的 AUTH_SECRET 必须一致 */
  authSecret: process.env.AUTH_SECRET ?? '',
  maxAssetBytes: Number(process.env.MAX_ASSET_BYTES ?? 20 * 1024 * 1024),
  displayMaxEdge: Number(process.env.DISPLAY_MAX_EDGE ?? 2000),
  displayQuality: Number(process.env.DISPLAY_WEBP_QUALITY ?? 85),
  concurrency: Number(process.env.WORKER_CONCURRENCY ?? 3),
};

const QUEUES = ['capture'] as const;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function waitForDb(pool: Pool, attempts = 30): Promise<void> {
  for (let i = 1; i <= attempts; i += 1) {
    try {
      await pool.query('select 1');
      if (i > 1) console.log(`[${APP_SHORT}/worker] 数据库已就绪（第 ${i} 次尝试）`);
      return;
    } catch (err) {
      const wait = Math.min(1000 * i, 5000);
      if (i === 1) {
        console.log(`[${APP_SHORT}/worker] 等待数据库…（${(err as Error).message}）`);
      }
      if (i === attempts) throw err;
      await sleep(wait);
    }
  }
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString, max: 2 });
  await waitForDb(pool);

  const boss = new PgBoss({
    connectionString,
    schema: 'pgboss',
    max: env.concurrency,
    monitorStateIntervalSeconds: 30,
  });

  boss.on('error', (err: unknown) => {
    console.error(`[${APP_SHORT}/worker] pg-boss 错误`, err);
  });

  await boss.start();
  for (const queue of QUEUES) await boss.createQueue(queue);
  console.log(`[${APP_SHORT}/worker] pg-boss 已启动，队列: ${QUEUES.join(', ')}`);

  const db = getDb();

  await boss.work('capture', async (jobs: unknown) => {
    const list = Array.isArray(jobs) ? jobs : [jobs];
    for (const job of list) {
      const data = (job as { data?: CaptureJobData } | null)?.data;
      if (!data?.itemId) {
        console.warn(`[${APP_SHORT}/worker] capture 任务缺少 itemId，跳过`);
        continue;
      }
      await runCapture(data, {
        db,
        assetsDir: env.assetsDir,
        authSecret: env.authSecret,
        maxAssetBytes: env.maxAssetBytes,
        displayMaxEdge: env.displayMaxEdge,
        displayQuality: env.displayQuality,
      });
    }
  });

  console.log(
    `[${APP_SHORT}/worker] 就绪。并发=${env.concurrency}，图片目录=${env.assetsDir}`,
  );

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[${APP_SHORT}/worker] 收到 ${signal}，正在退出…`);
    try {
      await boss.stop({ graceful: true, timeout: 10_000 });
    } catch {
      /* 退出路径上不抛 */
    }
    await pool.end().catch(() => undefined);
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err: unknown) => {
  console.error(`[${APP_SHORT}/worker] 启动失败`, err);
  process.exit(1);
});
