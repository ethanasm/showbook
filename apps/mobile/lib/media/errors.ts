/**
 * Distinct error classes for the upload pipeline so callers can branch
 * on outcome without string-matching message text.
 *
 * `OverQuotaError` is special-cased everywhere because it routes the user
 * to the `over-quota` screen (not a generic toast). 402 from any HTTP step
 * surfaces as OverQuotaError, as does a server-side BAD_REQUEST whose
 * message looks like a quota refusal.
 */

export class OverQuotaError extends Error {
  readonly cause?: unknown;
  constructor(message: string = 'Over quota', cause?: unknown) {
    super(message);
    this.name = 'OverQuotaError';
    if (cause !== undefined) this.cause = cause;
  }
}

export class UploadCancelledError extends Error {
  constructor(message: string = 'Upload cancelled') {
    super(message);
    this.name = 'UploadCancelledError';
  }
}

export class UploadHttpError extends Error {
  readonly status: number;
  readonly step: 'intent' | 'put' | 'complete';
  constructor(status: number, step: 'intent' | 'put' | 'complete', message?: string) {
    super(message ?? `Upload step ${step} failed: HTTP ${status}`);
    this.name = 'UploadHttpError';
    this.status = status;
    this.step = step;
  }
}

const QUOTA_HINTS = [
  'storage is full',
  'storage limit',
  'reached its photo limit',
  'reached its video limit',
  'reached its media storage',
  'larger than',
  'exceed ',
];

/**
 * Server-side quota refusals come back as `BAD_REQUEST` (HTTP 400 in
 * tRPC's batch encoding) with a message that includes one of the hints
 * above. This lets callers map those to OverQuotaError without coupling
 * to a specific HTTP status.
 */
export function looksLikeQuotaMessage(message: string | null | undefined): boolean {
  if (!message) return false;
  const lower = message.toLowerCase();
  return QUOTA_HINTS.some((hint) => lower.includes(hint));
}
