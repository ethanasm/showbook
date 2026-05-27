import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { deleteFromR2, getPresignedReadUrl, headFromR2 } from './r2';
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

function publicBaseUrl(): string {
  // Mobile clients PUT to the URL we return from createUploadIntent
  // verbatim — they cannot prepend a base, so r2-mode URLs must be
  // absolute. Web clients are fine with either, but going through
  // the same shape keeps the two paths in sync. NEXTAUTH_URL is the
  // canonical public-facing origin (it's what the auth callback URLs
  // and Cloudflare Tunnel ingress agree on); falling back to empty
  // gives a server-relative URL for the dev flow that doesn't set it.
  const raw = process.env.NEXTAUTH_URL ?? '';
  return raw.replace(/\/+$/, '');
}

export async function getMediaUploadUrl(
  key: string,
  _contentType: string,
): Promise<string> {
  const config = getMediaConfig();
  if (config.storageMode === 'local') {
    // Local mode is used by the Playwright dev harness — clients on the
    // same origin can hit a server-relative URL.
    return `/api/media/upload?key=${encodeURIComponent(key)}`;
  }
  // R2 mode previously returned a presigned R2 URL so clients PUT
  // directly to `*.r2.cloudflarestorage.com`. That path failed with 403
  // for every mobile upload (29 stuck-pending media_assets, zero ever
  // ready) and the mobile telemetry that was supposed to capture R2's
  // response never reached us. We now proxy through `/api/media/upload`
  // and let the server `uploadToR2` (AWS SDK direct send — the same
  // call path that already works for HEAD / DELETE in prod). Trade-off
  // is bandwidth doubled vs. direct-to-R2, which is fine at our scale.
  return `${publicBaseUrl()}/api/media/upload?key=${encodeURIComponent(key)}`;
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
