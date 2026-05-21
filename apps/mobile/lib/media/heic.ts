/**
 * HEIC normalization for the upload pipeline.
 *
 * iPhone's photo library hands back HEIC files by default. The web
 * client can't render HEIC (Chrome/Firefox have no decoder), so even a
 * successful upload would fail to display on the web. The web client
 * already re-encodes HEIC to WebP via `heic-to` before upload (see
 * `apps/web/components/media/uploadHelpers.ts`); this is the mobile
 * equivalent — but JPEG instead of WebP because
 * `expo-image-manipulator`'s native re-encoder targets JPEG/PNG only.
 *
 * The PUT step now uses the native upload task (which honors the
 * explicit Content-Type header regardless of the file's intrinsic MIME),
 * so the HEIC → JPEG conversion is purely about cross-browser
 * viewability — not a precondition for the upload to succeed.
 *
 * Module hygiene: this file MUST NOT statically import
 * `expo-image-manipulator` or `expo-file-system`. Both transitively
 * import `react-native`, whose `typeof` syntax trips the esbuild
 * transformer that `tsx` uses for `node --test`. The default deps
 * lazy-load them via dynamic `import()`, which the tsx loader only
 * resolves at call time — and tests always pass their own `deps`, so
 * they never reach it.
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
 * unit test stub out the native manipulator + file-stat without spinning
 * up Expo's native modules.
 */
export interface NormalizerDeps {
  manipulate(uri: string): Promise<{ uri: string; width: number; height: number }>;
  measureBytes(uri: string): Promise<number>;
}

let cachedDefaultDeps: NormalizerDeps | null = null;

async function getDefaultDeps(): Promise<NormalizerDeps> {
  if (cachedDefaultDeps) return cachedDefaultDeps;
  const [manipulator, fileSystem] = await Promise.all([
    import('expo-image-manipulator'),
    import('expo-file-system/legacy'),
  ]);
  cachedDefaultDeps = {
    async manipulate(uri) {
      const result = await manipulator.manipulateAsync(uri, [], {
        compress: JPEG_QUALITY,
        format: manipulator.SaveFormat.JPEG,
      });
      return { uri: result.uri, width: result.width, height: result.height };
    },
    async measureBytes(uri) {
      // `fetch(file://…)` reads the whole file into memory just to read
      // `blob.size`, and on iOS its behavior with cache URIs from
      // ImageManipulator has been inconsistent across SDK versions.
      // `getInfoAsync` does a single stat() syscall and returns the size
      // directly without buffering the bytes.
      const info = await fileSystem.getInfoAsync(uri);
      if (!info.exists || info.isDirectory) {
        throw new Error(`Failed to measure ${uri}: file does not exist`);
      }
      return info.size;
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
