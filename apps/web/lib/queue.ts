/**
 * 任务入队（ADR-006：pg-boss，不用 Redis）
 *
 * web 只负责 send，worker 负责 consume。两边共用同一个 pgboss schema。
 * 单例缓存在 globalThis 上，避免 Next 热重载时堆出一堆 boss 实例。
 */
import PgBoss from 'pg-boss';

type QueueGlobal = typeof globalThis & { __pbBoss?: Promise<PgBoss> };

const g = globalThis as QueueGlobal;

async function createBoss(): Promise<PgBoss> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('[queue] DATABASE_URL 未设置');

  const boss = new PgBoss({
    connectionString,
    schema: 'pgboss',
    max: 2,
  });
  boss.on('error', (err: unknown) => console.error('[queue] pg-boss 错误', err));

  await boss.start();
  await boss.createQueue('capture');
  return boss;
}

function getBoss(): Promise<PgBoss> {
  if (!g.__pbBoss) {
    g.__pbBoss = createBoss().catch((err: unknown) => {
      // 失败不缓存，下次请求重试
      g.__pbBoss = undefined;
      throw err;
    });
  }
  return g.__pbBoss;
}

export async function enqueueCapture(itemId: string): Promise<string | null> {
  const boss = await getBoss();
  const jobId = await boss.send('capture', { itemId });
  return jobId ?? null;
}
