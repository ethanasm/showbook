/**
 * M4 upload pipeline.
 *
 * Per file the flow is:
 *   1. Ask the server for a presigned upload URL (`createUploadIntent`).
 *   2. PUT the source file to R2 via the native upload task (with progress).
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
 *
 * Why a native upload task (vs. `fetch` + `Blob`):
 *   - React Native's `fetch(file://…)` reads the entire file into a Blob
 *     in JS memory. For multi-megabyte photos this is slow and risks
 *     OOM on older devices.
 *   - When a Blob body is PUT, the RN runtime can override the explicit
 *     `Content-Type` header with the Blob's intrinsic `type`. On iOS that
 *     intrinsic type is `application/octet-stream` for HEIC files (the OS
 *     has no system-wide MIME mapping for HEIC), which doesn't match the
 *     presigned URL's signed Content-Type and produces a 403
 *     SignatureDoesNotMatch from R2. Every previous mobile upload attempt
 *     hit exactly this — the prod DB had 25 stuck-pending `media_assets`
 *     rows with `mime_type=image/heic` and no successful upload.
 *   - `FileSystem.createUploadTask` (expo-file-system/legacy) uses the
 *     native NSURLSessionUploadTask on iOS and OkHttp on Android. Both
 *     respect the explicit `Content-Type` header verbatim and stream the
 *     file from disk without buffering it in JS memory.
 */

import { reportClientEvent, describeError } from '../telemetry';
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

/**
 * Native upload task result. The PUT step boils down to: I got an HTTP
 * status back and (optionally) the first ~1 KB of the response body for
 * diagnostics. Anything richer would couple the upload pipeline to a
 * specific transport library.
 */
export interface PutResult {
  status: number;
  /** First ~1 KB of the response body. R2's XML error envelope fits in well under that. */
  bodyPreview: string | null;
}

/**
 * The PUT step is abstracted behind this interface so tests can replace
 * the native upload task with a deterministic stub. Production wires
 * `defaultPutFile` (expo-file-system createUploadTask) at call time.
 *
 * `authToken` is forwarded when the target URL points at our own
 * `/api/media/upload` proxy (which requires Bearer auth). When the
 * target URL is a presigned R2 URL the auth is in the signature
 * itself and the bearer would be redundant — but it does no harm to
 * forward it either way, so callers can hand the same value in.
 */
export type PutFileFn = (args: {
  target: UploadTarget;
  fileUri: string;
  signal: AbortSignal | undefined;
  authToken: string | null;
}) => Promise<PutResult>;

export interface UploadOptions {
  server: UploadServer;
  showId: string;
  /** Performer ids to attach when calling `createUploadIntent`. */
  performerIds?: string[];
  /**
   * Getter for the current Showbook JWT — invoked once per PUT attempt
   * so a token refresh between createUploadIntent and the upload is
   * picked up. The proxy upload route (`/api/media/upload`) requires
   * `Authorization: Bearer <jwt>`; without this the PUT 401s and
   * `Upload step put failed: HTTP 401` surfaces in the UI. Required
   * for r2-mode uploads in prod; tests + the local-storage-mode path
   * can omit it.
   */
  getAuthToken?: () => string | null;
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
  /** PUT step override — used by tests to skip expo-file-system. */
  putImpl?: PutFileFn;
}

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_BACKOFF_MS = 250;
const MAX_BACKOFF_MS = 4000;
const RESPONSE_BODY_PREVIEW_BYTES = 1024;

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

let cachedDefaultPut: PutFileFn | null = null;

/**
 * Default PUT implementation — backed by `expo-file-system/legacy`'s
 * `createUploadTask`. Lazy-loaded so unit tests that always inject
 * `putImpl` never touch the native module.
 *
 * `createUploadTask` returns an `UploadTask` with `uploadAsync()` and
 * `cancelAsync()`. We race the upload against the abort signal so a
 * user-cancel mid-flight tears down the native task instead of letting
 * it complete in the background.
 */
async function defaultPutFile(args: {
  target: UploadTarget;
  fileUri: string;
  signal: AbortSignal | undefined;
  authToken: string | null;
}): Promise<PutResult> {
  if (!cachedDefaultPut) {
    const FileSystem = await import('expo-file-system/legacy');
    cachedDefaultPut = async ({ target, fileUri, signal, authToken }) => {
      const headers: Record<string, string> = {
        'Content-Type': target.mimeType,
      };
      // The proxy upload route (`POST /api/media/upload`) requires a
      // Bearer JWT — same shape as tRPC. Presigned R2 URLs ignore
      // unrecognised headers, so attaching the token unconditionally
      // when we have one is safe and removes the need to branch on
      // URL shape here.
      if (authToken) headers.Authorization = `Bearer ${authToken}`;
      const task = FileSystem.createUploadTask(target.uploadUrl, fileUri, {
        httpMethod: 'PUT',
        uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
        headers,
      });
      let cancelled = false;
      const onAbort = () => {
        cancelled = true;
        task.cancelAsync().catch(() => undefined);
      };
      if (signal) {
        if (signal.aborted) {
          onAbort();
          throw new UploadCancelledError();
        }
        signal.addEventListener('abort', onAbort);
      }
      try {
        const result = await task.uploadAsync();
        if (cancelled) throw new UploadCancelledError();
        if (!result) throw new UploadCancelledError();
        const body = result.body ?? '';
        return {
          status: result.status,
          bodyPreview:
            body.length === 0
              ? null
              : body.length <= RESPONSE_BODY_PREVIEW_BYTES
                ? body
                : `${body.slice(0, RESPONSE_BODY_PREVIEW_BYTES)}…`,
        };
      } finally {
        if (signal) signal.removeEventListener('abort', onAbort);
      }
    };
  }
  return cachedDefaultPut(args);
}

/**
 * PUT a single variant's bytes to its presigned URL. Treats 402 as
 * over-quota and 5xx as retryable. Cancellation is wired through `signal`
 * — the native upload task is torn down on abort.
 *
 * Progress fractions are reported at variant boundaries by the caller.
 * The native upload task does emit per-byte progress callbacks but we
 * deliberately keep the contract coarse so the UI logic doesn't have to
 * interpolate across retries.
 */
async function putToS3(
  target: UploadTarget,
  fileUri: string,
  put: PutFileFn,
  signal: AbortSignal | undefined,
  authToken: string | null,
): Promise<void> {
  let res: PutResult;
  try {
    res = await put({ target, fileUri, signal, authToken });
  } catch (err) {
    if (err instanceof UploadCancelledError) throw err;
    if (isAbortError(err)) throw new UploadCancelledError();
    reportClientEvent({
      event: 'upload.put.network_error',
      level: 'error',
      message: describeError(err),
      context: {
        host: safeHostFromUrl(target.uploadUrl),
        key: target.key,
        mimeType: target.mimeType,
      },
    });
    throw err;
  }
  if (res.status === 402) {
    throw new OverQuotaError('Storage limit reached');
  }
  if (res.status < 200 || res.status >= 300) {
    // R2 (and any S3-compatible service) returns an XML body explaining
    // the failure — `<Error><Code>SignatureDoesNotMatch</Code>…</Error>`
    // — so capture the body preview and ship it to Axiom under
    // `mobile.upload.put.failed` so ops can distinguish auth vs.
    // signature vs. routing failures.
    reportClientEvent({
      event: 'upload.put.failed',
      level: 'error',
      message: `R2 PUT ${res.status}`,
      context: {
        status: res.status,
        host: safeHostFromUrl(target.uploadUrl),
        key: target.key,
        mimeType: target.mimeType,
        bodyPreview: res.bodyPreview,
      },
    });
    throw new UploadHttpError(res.status, 'put');
  }
}

/**
 * Pull the host out of a presigned URL for logging without leaking the
 * signature. Falls back to a redacted marker if the URL is malformed.
 */
function safeHostFromUrl(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '<malformed-url>';
  }
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
  const sleep = opts.sleepImpl ?? defaultSleep;
  const put = opts.putImpl ?? defaultPutFile;
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

  // Lifecycle markers — every upload fires `upload.start`, and exactly one
  // terminal `upload.success` / `upload.failed_at` (with a `stage` field).
  // These markers let us locate the exact failing stage in Axiom without
  // rebuilding the app.
  const t0 = Date.now();
  reportClientEvent({
    event: 'upload.start',
    level: 'warn',
    message: 'upload started',
    context: {
      showId: opts.showId,
      mediaType: file.mediaType,
      mimeType: file.mimeType,
      bytes: file.bytes,
    },
  });

  // HEIC normalization used to live here (PR #319) but `manipulateAsync`
  // crashed iOS natively on the user's HEIC inputs, force-closing the
  // app the moment the OTA bundle finally caught up to that code. PR
  // #334's native upload task honors the explicit `Content-Type` header
  // regardless of the file's intrinsic MIME, so HEIC bytes upload
  // cleanly to R2. Cross-browser viewability is handled downstream:
  // mobile Safari / Chrome render HEIC natively, and the web client's
  // existing `heic-to` decoder converts on display
  // (`apps/web/components/media/uploadHelpers.ts` and the show-detail
  // gallery). No JS-side re-encode required.

  let intent: UploadIntentResult;
  try {
    intent = await withRetry(
      () => callIntent(opts.server, buildIntentInput(file, opts.showId, opts.performerIds)),
      retryDeps,
    );
  } catch (err) {
    if (!isUserCancellation(err)) {
      reportClientEvent({
        event: 'upload.failed_at',
        level: 'error',
        message: describeError(err),
        context: { stage: 'intent', showId: opts.showId, elapsedMs: Date.now() - t0 },
      });
    }
    throw err;
  }

  const totalSteps = intent.targets.length + 1; // +1 for the confirm step

  for (let i = 0; i < intent.targets.length; i++) {
    const target = intent.targets[i]!;
    try {
      await withRetry(
        // Resolve the token per attempt so a refresh that happens while
        // the upload is in-flight is picked up on the next retry.
        () =>
          putToS3(
            target,
            file.uri,
            put,
            opts.signal,
            opts.getAuthToken?.() ?? null,
          ),
        retryDeps,
      );
    } catch (err) {
      // The PUT step's own error reporters already fired
      // (upload.put.failed / upload.put.network_error). Add a terminal
      // marker so Axiom can group failures by stage. Skip on user-cancel.
      if (!isUserCancellation(err)) {
        reportClientEvent({
          event: 'upload.failed_at',
          level: 'error',
          message: describeError(err),
          context: { stage: 'put', targetIndex: i, elapsedMs: Date.now() - t0 },
        });
      }
      throw err;
    }
    reportProgress((i + 1) / totalSteps);
  }

  let result: MediaAssetDto;
  try {
    result = await withRetry(
      () => callComplete(opts.server, intent.assetId),
      retryDeps,
    );
  } catch (err) {
    if (!isUserCancellation(err)) {
      reportClientEvent({
        event: 'upload.failed_at',
        level: 'error',
        message: describeError(err),
        context: { stage: 'complete', assetId: intent.assetId, elapsedMs: Date.now() - t0 },
      });
    }
    throw err;
  }
  reportProgress(1);

  reportClientEvent({
    event: 'upload.success',
    level: 'warn',
    message: 'upload complete',
    context: { assetId: result.id, elapsedMs: Date.now() - t0 },
  });

  return result;
}

/**
 * Cancellation is not a failure — when the user taps cancel or backgrounds
 * the app, the abort signal fires and we surface UploadCancelledError.
 * Don't log either UploadCancelledError or a bare AbortError as a failure
 * marker; the UI already knows to drop it silently.
 */
function isUserCancellation(err: unknown): boolean {
  if (err instanceof UploadCancelledError) return true;
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: string; code?: string };
  return e.name === 'AbortError' || e.code === 'ABORT_ERR';
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
