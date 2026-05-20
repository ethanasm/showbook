/**
 * HEIC normalization for the upload pipeline.
 *
 * iPhone's photo library hands back HEIC files by default. R2's presigned
 * URL is signed with the picker-reported MIME, but on iOS RN's
 * `fetch('file://…HEIC')` returns a Blob whose intrinsic `type` is
 * `application/octet-stream` (the OS has no system-wide MIME mapping for
 * HEIC) — and when a Blob body is PUT, the runtime can use `blob.type` in
 * place of the explicit `Content-Type` header. R2 then sees a Content-Type
 * that doesn't match the signature and returns 403 SignatureDoesNotMatch.
 *
 * Beyond the upload itself, HEIC isn't renderable in Chrome or Firefox,
 * so even a successful upload would fail to display on the web client.
 * The web client already re-encodes HEIC to WebP via `heic-to` before
 * upload (see `apps/web/components/media/uploadHelpers.ts`); this is the
 * mobile equivalent — but JPEG instead of WebP because
 * `expo-image-manipulator`'s native re-encoder targets JPEG/PNG only.
 *
 * Module hygiene: this file MUST NOT statically import
 * `expo-image-manipulator`. That package transitively imports
 * `react-native`, whose `typeof` syntax trips the esbuild transformer
 * that `tsx` uses for `node --test`. The default deps lazy-load it via
 * dynamic `import()`, which the tsx loader only resolves at call time
 * — and tests always pass their own `deps`, so they never reach it.
 */

import type { SelectedFile } from './types';

const HEIC_MIME_TYPES = new Set(['image/heic', 'image/heif']);
const JPEG_QUALITY = 0.92;

export function shouldConvertHeic(
  file: Pick<SelectedFile, 'mediaType' | 'mimeType'>,
): boolean {
  if (file.mediaType !== 'photo') return false;
  return HEIC_MIME_TYPES.has(file.mimeType.toLowerCase());
}

/**
 * Minimal interface for the side effects this helper performs. Lets the
 * unit test stub out the native manipulator + file-read without spinning
 * up Expo's native modules.
 */
export interface NormalizerDeps {
  manipulate(uri: string): Promise<{ uri: string; width: number; height: number }>;
  measureBytes(uri: string): Promise<number>;
}

let cachedDefaultDeps: NormalizerDeps | null = null;

async function getDefaultDeps(): Promise<NormalizerDeps> {
  if (cachedDefaultDeps) return cachedDefaultDeps;
  const mod = await import('expo-image-manipulator');
  cachedDefaultDeps = {
    async manipulate(uri) {
      const result = await mod.manipulateAsync(uri, [], {
        compress: JPEG_QUALITY,
        format: mod.SaveFormat.JPEG,
      });
      return { uri: result.uri, width: result.width, height: result.height };
    },
    async measureBytes(uri) {
      const res = await fetch(uri);
      if (!res.ok) throw new Error(`Failed to measure ${uri}: ${res.status}`);
      const blob = await res.blob();
      return blob.size;
    },
  };
  return cachedDefaultDeps;
}

/**
 * Convert HEIC photos to JPEG ahead of upload. Returns the file unchanged
 * for any non-HEIC input (video, JPEG, PNG, WebP, …).
 *
 * Width/height fall back to the original asset's dimensions if the
 * manipulator returns 0 (defensive — it shouldn't, but the type allows it).
 */
export async function normalizeForUpload(
  file: SelectedFile,
  deps?: NormalizerDeps,
): Promise<SelectedFile> {
  if (!shouldConvertHeic(file)) return file;
  const effectiveDeps = deps ?? (await getDefaultDeps());
  const converted = await effectiveDeps.manipulate(file.uri);
  const bytes = await effectiveDeps.measureBytes(converted.uri);
  return {
    ...file,
    uri: converted.uri,
    mimeType: 'image/jpeg',
    bytes,
    width: converted.width || file.width,
    height: converted.height || file.height,
  };
}

/** Test-only — clear the cached default deps so a previous test's deps don't leak. */
export function __resetHeicDefaultsForTests(): void {
  cachedDefaultDeps = null;
}
