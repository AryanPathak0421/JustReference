import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { env } from '../config/env';
import { randomToken } from '../core/crypto';

/**
 * File storage behind an interface. `public` files (listing images, logos) are served to anyone;
 * `private` files (KYC documents) only through authenticated endpoints.
 * Production can swap in an S3 / R2 / Azure Blob driver without touching callers.
 */
export type Visibility = 'public' | 'private';

export interface StorageDriver {
  put(key: string, data: Buffer, visibility: Visibility): Promise<void>;
  get(key: string, visibility: Visibility): Promise<Buffer | null>;
  remove(key: string, visibility: Visibility): Promise<void>;
}

/** Keys look like `2026/11/<random>.webp`. Anything else is rejected before touching the filesystem. */
export const KEY_PATTERN = /^\d{4}\/\d{2}\/[A-Za-z0-9_-]{20,}\.(webp|pdf|jpg|png)$/;

export function newKey(ext: 'webp' | 'pdf' | 'jpg' | 'png') {
  const d = new Date();
  return `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${randomToken(18)}.${ext}`;
}

function localDriver(root: string): StorageDriver {
  const path = (key: string, v: Visibility) => {
    if (!KEY_PATTERN.test(key)) throw new Error('Invalid storage key');
    return resolve(root, v, key);
  };
  return {
    async put(key, data, v) {
      const p = path(key, v);
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, data, { flag: 'wx' }); // never overwrite
    },
    async get(key, v) {
      try { return await readFile(path(key, v)); } catch { return null; }
    },
    async remove(key, v) {
      await rm(path(key, v), { force: true });
    },
  };
}

export const storage: StorageDriver = localDriver(resolve(process.cwd(), env.UPLOAD_DIR));

export const publicUrl = (key: string | null | undefined) => (key ? `/api/v1/media/${key}` : null);
