/**
 * 资源文件读写（本地盘）
 *
 * 安全要点：storageKey 来自数据库，但仍然是"字符串拼路径"，
 * 必须校验解析后的绝对路径没有跳出 ASSETS_DIR（防路径穿越）。
 */
import { readFile, stat, unlink } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { env } from './env';

const ROOT = resolve(env.assetsDir);

export class UnsafePathError extends Error {
  constructor(key: string) {
    super(`非法的资源路径: ${key}`);
    this.name = 'UnsafePathError';
  }
}

export function resolveAssetPath(storageKey: string): string {
  const full = resolve(join(ROOT, storageKey));
  if (full !== ROOT && !full.startsWith(ROOT + sep)) {
    throw new UnsafePathError(storageKey);
  }
  return full;
}

export type AssetFile = {
  body: Buffer;
  etag: string;
  mtime: Date;
};

export async function readAsset(storageKey: string): Promise<AssetFile> {
  const path = resolveAssetPath(storageKey);
  const [body, info] = await Promise.all([readFile(path), stat(path)]);
  return {
    body,
    // 内容寻址的文件名不会变，用 size+mtime 做 ETag 足够
    etag: `"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`,
    mtime: info.mtime,
  };
}

/**
 * 删除一组变体文件。
 *
 * 数据库行靠外键 cascade 自动清，但**磁盘文件不会**——
 * 删条目时如果只管库，图片就成了永远不会被引用的孤儿文件，
 * 在 NAS 上慢慢吃空间。所以这里逐个 unlink。
 *
 * 文件不存在不算错（可能是并发删除或从未写成功）。
 */
export async function deleteAssetFiles(storageKeys: string[]): Promise<{ deleted: number; failed: number }> {
  let deleted = 0;
  let failed = 0;

  for (const key of storageKeys) {
    try {
      await unlink(resolveAssetPath(key));
      deleted += 1;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') continue; // 已经不在了
      failed += 1;
      console.warn(`[storage] 删除文件失败 ${key}: ${(err as Error).message}`);
    }
  }

  return { deleted, failed };
}
