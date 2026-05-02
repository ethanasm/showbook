/**
 * M4 upload pipeline.
 *
 * Per file the flow is:
 *   1. Ask the server for a presigned upload URL (`createUploadIntent`).
 *   2. PUT the source bytes to S3 at the returned URL (with progress).
 *   3. Confirm the upload (`completeUpload`) so the server flips the row
 *      from `pending` to `ready` and kicks off transcode.
 *
 * Retries: each step retries on 5xx + transient network errors with a
 * capped exponential backoff. Aborts (cancel button or unmount) propagate
 * as `UploadCancelledError` and are NOT retried.
 *
 * Over-quota: the server returns BAD_REQUEST with a quota-shaped message
 * when limits are exceeded; some deployments may return raw HTTP 402.
 * Both surface as `OverQuotaError` so the caller routes the user to the
 * `over-quota` screen instead of showing a generic toast.
 */

import {
  OverQuotaError,
  UploadCancelledError,
  UploadHttpError,
  looksLikeQuotaMessage,
} from './errors';
import type {
  MediaAssetDto,
  SelectedFile,
  UploadIntentInput,
  UploadIntentResult,
  UploadServer,
  UploadTarget,
} from './types';

export interface UploadOptions {
  server: UploadServer;
  showId: string;
  /** Optional fetch impl override — defaults to globalThis.fetch. Used by tests. */
  fetchImpl?: typeof globalThis.fetch;
  /** Performer ids to attach when calling `createUploadIntent`. */
  performerIds?: string[];
  /** Cancel signal. When aborted, in-flight PUTs cancel and an UploadCancelledError throws. */
  signal?: AbortSignal;
  /** Per-file progress: monotonically non-decreasing, 0..1 inclusive. */
  onProgress?: (fraction: number) => void;
  /** Override default retry count (default 3 retries → 4 total attempts). */
  maxRetries?: number;
  /** Override base backoff in ms (default 250ms; capped at 4000ms). */
  baseBackoffMs?: number;
  /** Sleep impl override — used by tests to skip the wall clock. */
  sleepImpl?: (ms: number) => Promise<void>;
}

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_BACKOFF_MS = 250;
const MAX_BACKOFF_MS = 4000;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffDelay(attempt: number, base: number): number {
  return Math.min(MAX_BACKOFF_MS, base * 2 ** attempt);
}

function isRetryableHttpStatus(status: number): boolean {
  return status >= 500 && status < 600;
}

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: string; code?: string };
  return e.name === 'AbortError' || e.code === 'ABORT_ERR';
}

function ensureNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new UploadCancelledError();
}

interface RetryDeps {
  signal?: AbortSignal;
  maxRetries: number;
  baseBackoffMs: number;
  sleep: (ms: number) => Promise<void>;
}

/**
 * Run `op` with retry on transient errors. The pipeline distinguishes:
 *   - over-quota: never retry, surface immediately
 *   - cancellation: never retry, surface immediately
 *   - 5xx / network: retry up to `maxRetries` times with backoff
 *   - 4xx (other): never retry, surface as a generic HTTP error
 */
async function withRetry<T>(
  op: (attempt: number) => Promise<T>,
  deps: RetryDeps,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= deps.maxRetries; attempt++) {
    ensureNotAborted(deps.signal);
    try {
      return await op(attempt);
    } catch (err) {
      if (err instanceof OverQuotaError) throw err;
      if (err instanceof UploadCancelledError) throw err;
      if (isAbortError(err)) throw new UploadCancelledError();
      if (err instanceof UploadHttpError && !isRetryableHttpStatus(err.status)) {
        throw err;
      }
      lastErr = err;
      if (attempt === deps.maxRetries) break;
      await deps.sleep(backoffDelay(attempt, deps.baseBackoffMs));
    }
  }
  throw lastErr ?? new Error('Upload failed after retries');
}

function buildIntentInput(
  file: SelectedFile,
  showId: string,
  performerIds?: string[],
): UploadIntentInput {
  return {
    showId,
    mediaType: file.mediaType,
    mimeType: file.mimeType,
    sourceBytes: file.bytes,
    storedBytes: file.bytes,
    width: file.width,
    height: file.height,
    durationMs: file.durationMs,
    caption: file.caption,
    performerIds: performerIds && performerIds.length > 0 ? performerIds : undefined,
    variants: [
      {
        name: 'source',
        mimeType: file.mimeType,
        bytes: file.bytes,
        width: file.width,
        height: file.height,
      },
    ],
  };
}

async function callIntent(
  server: UploadServer,
  input: UploadIntentInput,
): Promise<UploadIntentResult> {
  try {
    return await server.createUploadIntent(input);
  } catch (err) {
    throw mapServerError(err, 'intent');
  }
}

async function callComplete(
  server: UploadServer,
  assetId: string,
): Promise<MediaAssetDto> {
  try {
    return await server.completeUpload({ assetId });
  } catch (err) {
    throw mapServerError(err, 'complete');
  }
}

function mapServerError(err: unknown, step: 'intent' | 'complete'): Error {
  if (err instanceof OverQuotaError) return err;
  if (err instanceof UploadCancelledError) return err;
  if (isAbortError(err)) return new UploadCancelledError();
  const message =
    err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  // tRPC clients raise an Error with the server's message attached. The
  // server uses BAD_REQUEST for quota refusals, so we string-match the
  // canonical hints to recover the over-quota signal here.
  if (looksLikeQuotaMessage(message)) {
    return new OverQuotaError(message, err);
  }
  // Some deployments / proxies map the BAD_REQUEST to 402 — handle that
  // shape too. tRPC errors put status under `data.httpStatus` or `code`.
  const errAny = err as { data?: { httpStatus?: number }; status?: number };
  const status = errAny?.data?.httpStatus ?? errAny?.status;
  if (status === 402) return new OverQuotaError(message || 'Over quota', err);
  if (typeof status === 'number') {
    return new UploadHttpError(status, step, message);
  }
  return err instanceof Error ? err : new Error(message || 'Upload failed');
}

/**
 * PUT a single variant's bytes to its presigned URL. Reports progress as
 * 0..1 fractions through `onProgress`. Treats 402 as over-quota and 5xx
 * as retryable. Cancellation is wired through `signal`.
 *
 * The fetch API's progress events aren't available in React Native, so we
 * report start (0) and end (1). Multi-variant flows interpolate across
 * variants. The progress callback is monotonically non-decreasing.
 */
async function putToS3(
  target: UploadTarget,
  body: Blob,
  fetchImpl: typeof globalThis.fetch,
  signal: AbortSignal | undefined,
): Promise<void> {
  let res: Response;
  try {
    res = await fetchImpl(target.uploadUrl, {
      method: 'PUT',
      body,
      headers: { 'Content-Type': target.mimeType },
      signal,
    });
  } catch (err) {
    if (isAbortError(err)) throw new UploadCancelledError();
    throw err;
  }
  if (res.status === 402) {
    throw new OverQuotaError('Storage limit reached');
  }
  if (!res.ok) {
    throw new UploadHttpError(res.status, 'put');
  }
}

/**
 * Read a `file://` URI into a Blob the fetch impl can PUT. React Native's
 * fetch supports passing a Blob directly. The caller controls fetch impl
 * (tests stub it), so this helper just opens the file once.
 */
async function readFileAsBlob(
  uri: string,
  mimeType: string,
  fetchImpl: typeof globalThis.fetch,
): Promise<Blob> {
  // RN's fetch accepts file:// URIs; this is the simplest cross-platform
  // path that doesn't require a separate FS module. If we ever target web,
  // swap to a FormData / File path.
  const res = await fetchImpl(uri);
  if (!res.ok) throw new Error(`Failed to read source file: ${res.status}`);
  const blob = await res.blob();
  // Some platforms return a blob with type=''; ensure mimeType for S3.
  if (!blob.type) {
    return new Blob([blob], { type: mimeType });
  }
  return blob;
}

/**
 * Upload a single file end-to-end. Returns the ready DTO from the server.
 *
 * Progress fractions:
 *   - 0   on start
 *   - per-target completion: (i + 1) / (targets.length + 1)
 *   - 1   on confirm
 *
 * If `targets.length === 1` (the common case for the mobile picker) the
 * curve is 0 → 0.5 → 1.
 */
export async function uploadFile(
  file: SelectedFile,
  opts: UploadOptions,
): Promise<MediaAssetDto> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const sleep = opts.sleepImpl ?? defaultSleep;
  const retryDeps: RetryDeps = {
    signal: opts.signal,
    maxRetries: opts.maxRetries ?? DEFAULT_MAX_RETRIES,
    baseBackoffMs: opts.baseBackoffMs ?? DEFAULT_BASE_BACKOFF_MS,
    sleep,
  };

  const onProgress = opts.onProgress;
  let lastReported = -1;
  function reportProgress(fraction: number): void {
    if (!onProgress) return;
    const clamped = Math.max(0, Math.min(1, fraction));
    if (clamped <= lastReported) return;
    lastReported = clamped;
    onProgress(clamped);
  }

  ensureNotAborted(opts.signal);
  reportProgress(0);

  const intent = await withRetry(
    () => callIntent(opts.server, buildIntentInput(file, opts.showId, opts.performerIds)),
    retryDeps,
  );

  const totalSteps = intent.targets.length + 1; // +1 for the confirm step
  const blob = await readFileAsBlob(file.uri, file.mimeType, fetchImpl);

  for (let i = 0; i < intent.targets.length; i++) {
    const target = intent.targets[i]!;
    await withRetry(
      () => putToS3(target, blob, fetchImpl, opts.signal),
      retryDeps,
    );
    reportProgress((i + 1) / totalSteps);
  }

  const result = await withRetry(
    () => callComplete(opts.server, intent.assetId),
    retryDeps,
  );
  reportProgress(1);
  return result;
}

/**
 * Upload a batch of files. Returns per-file outcomes so the upload sheet
 * can surface partial success — one file failing the quota check shouldn't
 * cancel the rest.
 */
export interface BatchOutcome {
  file: SelectedFile;
  status: 'success' | 'failed' | 'over-quota' | 'cancelled';
  result?: MediaAssetDto;
  error?: Error;
}

export async function uploadBatch(
  files: SelectedFile[],
  opts: Omit<UploadOptions, 'onProgress'> & {
    onItemProgress?: (index: number, fraction: number) => void;
  },
): Promise<BatchOutcome[]> {
  const outcomes: BatchOutcome[] = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i]!;
    if (opts.signal?.aborted) {
      outcomes.push({ file, status: 'cancelled', error: new UploadCancelledError() });
      continue;
    }
    try {
      const result = await uploadFile(file, {
        ...opts,
        onProgress: (fraction) => opts.onItemProgress?.(i, fraction),
      });
      outcomes.push({ file, status: 'success', result });
    } catch (err) {
      if (err instanceof OverQuotaError) {
        outcomes.push({ file, status: 'over-quota', error: err });
        // Stop the batch — the user needs to clear quota first.
        for (let j = i + 1; j < files.length; j++) {
          outcomes.push({
            file: files[j]!,
            status: 'cancelled',
            error: new UploadCancelledError('Skipped after over-quota'),
          });
        }
        break;
      }
      if (err instanceof UploadCancelledError) {
        outcomes.push({ file, status: 'cancelled', error: err });
        break;
      }
      outcomes.push({
        file,
        status: 'failed',
        error: err instanceof Error ? err : new Error(String(err)),
      });
    }
  }
  return outcomes;
}

export {
  OverQuotaError,
  UploadCancelledError,
  UploadHttpError,
} from './errors';
export type {
  MediaAssetDto,
  SelectedFile,
  UploadIntentInput,
  UploadIntentResult,
  UploadServer,
  UploadTarget,
} from './types';
