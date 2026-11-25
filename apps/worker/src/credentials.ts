/**
 * worker 侧：按域名查找站点凭据并解密。
 *
 * 凭据数量很少（通常 1–3 条），全量取回在内存里匹配即可，
 * 不用为它写 SQL 的域名后缀匹配。
 */
import { eq } from 'drizzle-orm';
import { decryptSecret, domainMatches } from '@pb/core';
import { siteCredential, type Database } from '@pb/db';

export type SiteCredential = {
  cookie: string;
  userAgent?: string;
  referer?: string;
  domain: string;
};

export async function findCredential(
  db: Database,
  host: string,
  authSecret: string,
): Promise<SiteCredential | null> {
  if (!authSecret) return null;

  let rows: Array<typeof siteCredential.$inferSelect>;
  try {
    rows = await db.select().from(siteCredential).where(eq(siteCredential.enabled, true));
  } catch (err) {
    console.warn('[credential] 读取站点凭据失败（表可能还没迁移）', err);
    return null;
  }

  const hit = rows.find((r) => domainMatches(host, r.domain));
  if (!hit) return null;

  try {
    return {
      cookie: decryptSecret(hit.cookieCipher, authSecret),
      userAgent: hit.userAgent ?? undefined,
      referer: hit.referer ?? undefined,
      domain: hit.domain,
    };
  } catch (err) {
    console.warn(
      `[credential] 解密失败（AUTH_SECRET 变过？）：${hit.domain}`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
