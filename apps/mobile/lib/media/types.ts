/**
 * Shared types for the M4 media upload pipeline.
 *
 * The pipeline talks to the existing `media.createUploadIntent` and
 * `media.completeUpload` tRPC procedures from `packages/api`. We don't
 * import those types directly to keep this file usable in node:test
 * (the API package pulls in node-only deps like postgres-js).
 */

export type MediaType = 'photo' | 'video';

/**
 * A file selected from the picker, ready to be uploaded.
 *
 * `bytes` is the source size on disk; `mimeType` is the picker's reported
 * content type. `width`/`height`/`durationMs` are optional and only
 * provided when the picker resolves them (photos always have w/h, videos
 * usually carry durationMs).
 */
export interface SelectedFile {
  uri: string;
  mediaType: MediaType;
  mimeType: string;
  bytes: number;
  width?: number;
  height?: number;
  durationMs?: number;
  caption?: string;
}

/**
 * Input shape for `media.createUploadIntent`. Mirrors the zod input on the
 * server. `variants` describes the post-processed assets we'd write to S3;
 * for the mobile uploader we send a single `source` variant — the server's
 * transcode pipeline produces the rest.
 */
export interface UploadIntentVariant {
  name: string;
  mimeType: string;
  bytes: number;
  width?: number;
  height?: number;
}

export interface UploadIntentInput {
  showId: string;
  mediaType: MediaType;
  mimeType: string;
  sourceBytes: number;
  storedBytes: number;
  width?: number;
  height?: number;
  durationMs?: number;
  caption?: string;
  performerIds?: string[];
  variants: UploadIntentVariant[];
}

export interface UploadTarget {
  name: string;
  key: string;
  mimeType: string;
  uploadUrl: string;
}

export interface UploadIntentResult {
  assetId: string;
  targets: UploadTarget[];
}

/**
 * Subset of the server's `media.completeUpload` return shape that the
 * mobile UI actually consumes. The full DTO has more fields (variants,
 * caption, sourceShow, etc.) — extend here as the UI grows.
 */
export interface MediaAssetDto {
  id: string;
  showId: string;
  mediaType: MediaType;
  status: 'pending' | 'ready' | 'failed';
  caption: string | null;
  bytes: number;
  performerIds: string[];
  urls: Record<string, string>;
}

/**
 * The pipeline talks to the server through this small interface so tests
 * can stub it out without spinning up tRPC. Production wires it to the
 * shared trpc client in `lib/trpc.ts`.
 */
export interface UploadServer {
  createUploadIntent: (input: UploadIntentInput) => Promise<UploadIntentResult>;
  completeUpload: (input: { assetId: string }) => Promise<MediaAssetDto>;
}
