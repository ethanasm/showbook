import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  deleteFromR2,
  getPresignedReadUrl,
  getPresignedUploadUrl,
  headFromR2,
} from './r2';
import { getMediaConfig } from './media-config';

// Allowed key shape: `showbook/<segment>/.../<segment>` where each segment
// matches a strict allowlist. Anchored at both ends so partial matches don't
// slip through. Disallows backslashes, `..`, leading/trailing slashes,
// double slashes, and any other path-traversal payloads.
const SAFE_KEY_RE = /^showbook(?:\/[A-Za-z0-9_-][A-Za-z0-9_.-]*)+$/;

function assertSafeKey(key: string): void {
  if (typeof key !== 'string' || key.length === 0 || key.length > 512) {
    throw new Error('Invalid media key');
  }
  if (!SAFE_KEY_RE.test(key)) {
    throw new Error('Invalid media key');
  }
  if (key.includes('..') || key.includes('\\') || path.isAbsolute(key)) {
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
  // Use path.relative so the comparison can't be fooled by tricky prefixes.
  const rel = path.relative(root, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Invalid media key');
  }
  return path.join(root, rel);
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
