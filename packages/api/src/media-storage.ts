import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  deleteFromR2,
  getPresignedReadUrl,
  getPresignedUploadUrl,
  headFromR2,
} from './r2';
import { getMediaConfig } from './media-config';

function assertSafeKey(key: string): void {
  if (!key.startsWith('showbook/')) {
    throw new Error('Invalid media key');
  }
  if (key.includes('..') || path.isAbsolute(key)) {
    throw new Error('Invalid media key');
  }
}

export function getLocalMediaRoot(): string {
  return (
    process.env.MEDIA_LOCAL_UPLOAD_ROOT ??
    path.join(process.cwd(), 'public', 'media-uploads')
  );
}

function localPathForKey(key: string): string {
  assertSafeKey(key);
  const root = path.resolve(getLocalMediaRoot());
  const target = path.resolve(root, key);
  // Defence in depth: even after assertSafeKey, verify the resolved path is
  // contained inside the media root before any fs operation runs against it.
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error('Invalid media key');
  }
  return target;
}

export async function storeLocalObject(
  key: string,
  body: Buffer,
): Promise<void> {
  const target = localPathForKey(key);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, body);
}

async function headLocalObject(key: string): Promise<{ bytes: number; contentType: string | null }> {
  const info = await stat(localPathForKey(key));
  return { bytes: info.size, contentType: null };
}

async function deleteLocalObject(key: string): Promise<void> {
  try {
    await unlink(localPathForKey(key));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}

export async function readLocalObject(key: string): Promise<Buffer> {
  return readFile(localPathForKey(key));
}

export async function getMediaUploadUrl(
  key: string,
  contentType: string,
): Promise<string> {
  const config = getMediaConfig();
  if (config.storageMode === 'local') {
    return `/api/media/upload?key=${encodeURIComponent(key)}`;
  }
  return getPresignedUploadUrl(key, contentType, config.uploadUrlTtlSeconds);
}

export async function getMediaReadUrl(key: string): Promise<string> {
  const config = getMediaConfig();
  if (config.storageMode === 'local') {
    return `/media-uploads/${key}`;
  }
  return getPresignedReadUrl(key, config.readUrlTtlSeconds);
}

export async function headMediaObject(
  key: string,
): Promise<{ bytes: number; contentType: string | null }> {
  const config = getMediaConfig();
  if (config.storageMode === 'local') return headLocalObject(key);
  return headFromR2(key);
}

export async function deleteMediaObject(key: string): Promise<void> {
  const config = getMediaConfig();
  if (config.storageMode === 'local') {
    await deleteLocalObject(key);
    return;
  }
  await deleteFromR2(key);
}
