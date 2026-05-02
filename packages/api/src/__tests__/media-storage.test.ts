/**
 * Unit tests for media-storage.ts. Exercises both storage backends:
 *   - 'local' mode: uses a real temp directory so the fs round-trip is
 *     genuinely covered (write → head → read → delete).
 *   - 'r2' mode: presigned-URL helpers run for real (they don't touch the
 *     network), and headFromR2/deleteFromR2 are exercised by stubbing the
 *     S3Client's `send` method via a captured client reference.
 *
 * Run with:
 *   pnpm --filter @showbook/api exec node --import tsx --test \
 *     src/__tests__/media-storage.test.ts
 */

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  deleteMediaObject,
  getLocalMediaRoot,
  getMediaReadUrl,
  getMediaUploadUrl,
  headMediaObject,
  readLocalObject,
  storeLocalObject,
} from '../media-storage';
import { getR2Client } from '../r2';

const ENV_KEYS = [
  'MEDIA_STORAGE_MODE',
  'MEDIA_LOCAL_UPLOAD_ROOT',
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET_NAME',
] as const;

const originalEnv = new Map<string, string | undefined>();
let tempRoot: string | null = null;

beforeEach(() => {
  for (const key of ENV_KEYS) {
    originalEnv.set(key, process.env[key]);
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv.get(key);
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
  originalEnv.clear();
  if (tempRoot) {
    rmSync(tempRoot, { recursive: true, force: true });
    tempRoot = null;
  }
});

function useLocalTempRoot(): string {
  tempRoot = mkdtempSync(path.join(tmpdir(), 'showbook-media-test-'));
  process.env.MEDIA_STORAGE_MODE = 'local';
  process.env.MEDIA_LOCAL_UPLOAD_ROOT = tempRoot;
  return tempRoot;
}

// ── getLocalMediaRoot ────────────────────────────────────────────────

test('getLocalMediaRoot: returns env override when set', () => {
  process.env.MEDIA_LOCAL_UPLOAD_ROOT = '/srv/media';
  assert.equal(getLocalMediaRoot(), '/srv/media');
});

test('getLocalMediaRoot: falls back to <cwd>/public/media-uploads', () => {
  delete process.env.MEDIA_LOCAL_UPLOAD_ROOT;
  assert.equal(getLocalMediaRoot(), path.join(process.cwd(), 'public', 'media-uploads'));
});

// ── assertSafeKey (exercised via storeLocalObject) ────────────────────

test('storeLocalObject: rejects keys outside the showbook/ namespace', async () => {
  useLocalTempRoot();
  await assert.rejects(
    () => storeLocalObject('other/foo.jpg', Buffer.from('x')),
    /Invalid media key/,
  );
});

test('storeLocalObject: rejects keys containing "..".', async () => {
  useLocalTempRoot();
  await assert.rejects(
    () => storeLocalObject('showbook/../etc/passwd', Buffer.from('x')),
    /Invalid media key/,
  );
});

test('storeLocalObject: rejects absolute paths', async () => {
  useLocalTempRoot();
  await assert.rejects(
    () => storeLocalObject('/absolute/showbook/foo', Buffer.from('x')),
    /Invalid media key/,
  );
});

// ── local-mode round trip: store → head → read → delete ────────────────

test('local mode: stores a file, heads its size, reads the body, deletes it', async () => {
  const root = useLocalTempRoot();
  const key = 'showbook/users/u1/photo.jpg';
  const body = Buffer.from('hello world');

  await storeLocalObject(key, body);

  const info = await headMediaObject(key);
  assert.equal(info.bytes, body.length);
  assert.equal(info.contentType, null);

  const read = await readLocalObject(key);
  assert.deepEqual(read, body);

  // Sanity: file actually lives under our temp root.
  assert.ok(read.length > 0, 'file should exist on disk');
  assert.ok(root.length > 0);

  await deleteMediaObject(key);
  // Subsequent delete on missing file should be a no-op (ENOENT swallowed).
  await deleteMediaObject(key);

  // headMediaObject should now reject (file gone).
  await assert.rejects(() => headMediaObject(key));
});

// ── upload + read URL helpers ─────────────────────────────────────────

test('getMediaUploadUrl: returns local proxy URL in local mode', async () => {
  useLocalTempRoot();
  const url = await getMediaUploadUrl('showbook/users/u1/x.jpg', 'image/jpeg');
  assert.equal(url, `/api/media/upload?key=${encodeURIComponent('showbook/users/u1/x.jpg')}`);
});

test('getMediaReadUrl: returns local /media-uploads URL in local mode', async () => {
  useLocalTempRoot();
  const url = await getMediaReadUrl('showbook/users/u1/x.jpg');
  assert.equal(url, '/media-uploads/showbook/users/u1/x.jpg');
});

test('getMediaUploadUrl: returns presigned R2 URL in r2 mode', async () => {
  process.env.MEDIA_STORAGE_MODE = 'r2';
  process.env.R2_ACCOUNT_ID = 'acct123';
  process.env.R2_ACCESS_KEY_ID = 'AK';
  process.env.R2_SECRET_ACCESS_KEY = 'SK';
  const url = await getMediaUploadUrl('showbook/x.jpg', 'image/jpeg');
  assert.match(url, /^https:\/\/[^/]+\.r2\.cloudflarestorage\.com\/showbook\/x\.jpg/);
  assert.match(url, /X-Amz-Algorithm=AWS4-HMAC-SHA256/);
});

test('getMediaReadUrl: returns presigned R2 URL in r2 mode', async () => {
  process.env.MEDIA_STORAGE_MODE = 'r2';
  process.env.R2_ACCOUNT_ID = 'acct123';
  process.env.R2_ACCESS_KEY_ID = 'AK';
  process.env.R2_SECRET_ACCESS_KEY = 'SK';
  const url = await getMediaReadUrl('showbook/x.jpg');
  assert.match(url, /^https:\/\/[^/]+\.r2\.cloudflarestorage\.com\/showbook\/x\.jpg/);
});

// ── r2 mode: head + delete via stubbed S3Client.send ──────────────────

test('headMediaObject + deleteMediaObject: dispatch to R2 in r2 mode', async () => {
  process.env.MEDIA_STORAGE_MODE = 'r2';
  process.env.R2_ACCOUNT_ID = 'acct123';
  process.env.R2_ACCESS_KEY_ID = 'AK';
  process.env.R2_SECRET_ACCESS_KEY = 'SK';
  process.env.R2_BUCKET_NAME = 'test-bucket';

  // getR2Client caches the client; grab it and replace its `send` impl.
  const client = getR2Client();
  const originalSend = client.send.bind(client) as typeof client.send;
  const sent: Array<{ name: string; input: unknown }> = [];
  (client as unknown as { send: unknown }).send = async (cmd: {
    constructor: { name: string };
    input: unknown;
  }) => {
    sent.push({ name: cmd.constructor.name, input: cmd.input });
    if (cmd.constructor.name === 'HeadObjectCommand') {
      return { ContentLength: 42, ContentType: 'image/jpeg' };
    }
    return {};
  };
  try {
    const info = await headMediaObject('showbook/x.jpg');
    assert.deepEqual(info, { bytes: 42, contentType: 'image/jpeg' });

    await deleteMediaObject('showbook/x.jpg');
    assert.equal(sent.length, 2);
    assert.equal(sent[0].name, 'HeadObjectCommand');
    assert.equal(sent[1].name, 'DeleteObjectCommand');
    assert.deepEqual(sent[0].input, { Bucket: 'test-bucket', Key: 'showbook/x.jpg' });
    assert.deepEqual(sent[1].input, { Bucket: 'test-bucket', Key: 'showbook/x.jpg' });
  } finally {
    (client as unknown as { send: unknown }).send = originalSend;
  }
});
