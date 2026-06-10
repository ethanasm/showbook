// Transient-transport detection shared by the external HTTP clients
// (google-places, wikidata, setlistfm). Undici surfaces socket-level
// failures as `err.cause.code` on a `TypeError: fetch failed`; those are
// connection blips (a remote host resetting a keep-alive socket mid-read),
// not API errors — the response never arrives, so a retry on a fresh
// connection clears them. HTTP error *responses* (4xx/5xx) don't throw
// from `fetch` and stay with each caller's `res.ok` handling.
const TRANSIENT_CAUSE_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'EAI_AGAIN',
  'EPIPE',
  'ENOTFOUND',
  'UND_ERR_SOCKET',
]);

export function isTransientFetchError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  // AbortSignal.timeout(...) fires a TimeoutError; a manual abort an AbortError.
  if (err.name === 'TimeoutError' || err.name === 'AbortError') return true;
  const code = (err as { cause?: { code?: unknown } }).cause?.code;
  if (typeof code === 'string' && TRANSIENT_CAUSE_CODES.has(code)) return true;
  // `TypeError: fetch failed` with no decodable cause is still a transport
  // failure (DNS / TLS / reset) rather than anything we can fix by not
  // retrying — treat it as transient.
  return err instanceof TypeError && err.message === 'fetch failed';
}

/** Short identifier for the `code` log field on `*.request.retry` events. */
export function transientErrorCode(err: unknown): string {
  return (
    (err as { cause?: { code?: string } }).cause?.code ??
    (err instanceof Error ? err.name : 'unknown')
  );
}
