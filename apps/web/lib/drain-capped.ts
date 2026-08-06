/**
 * Read a request body into memory, but never hold more than `maxBytes`.
 *
 * Why not `await request.arrayBuffer()`: that buffers the entire body before
 * any size check can run. `Content-Length` is not a defence — it is absent on
 * a chunked upload and a client can simply send a smaller value than it
 * intends to write — and Next.js App Router route handlers apply no body-size
 * limit of their own. So an authenticated caller could stream an arbitrarily
 * large body and force it all into process memory before the 413.
 *
 * Once the running total passes `maxBytes` we drop the retained chunks and stop
 * accumulating, but **keep reading to the end of the stream**. That matters for
 * the media-upload route: responding mid-upload makes iOS NSURLSession
 * background tasks report `NSURLErrorCannotParseResponse (-1017)` and mask the
 * real error, so the "drain fully, then answer" behaviour has to survive.
 */
export type DrainResult = {
  /** Body bytes, or empty when the cap was exceeded / the read failed. */
  body: Buffer;
  /** True when the stream carried more than `maxBytes`. */
  overflowed: boolean;
  /** The thrown error when the stream errored mid-read, else null. */
  readFailed: unknown | null;
};

export async function drainCapped(
  stream: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<DrainResult> {
  if (!stream) {
    return { body: Buffer.alloc(0), overflowed: false, readFailed: null };
  }

  const reader = stream.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  let overflowed = false;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;

      total += value.byteLength;
      if (!overflowed && total > maxBytes) {
        // Past the ceiling: release everything held so far and keep draining
        // without retaining any more of it.
        overflowed = true;
        chunks.length = 0;
      }
      if (!overflowed) chunks.push(Buffer.from(value));
    }
  } catch (err) {
    return {
      body: Buffer.alloc(0),
      overflowed,
      readFailed: err ?? new Error("stream read failed"),
    };
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Already released (the stream errored) — nothing to do.
    }
  }

  return {
    body: overflowed ? Buffer.alloc(0) : Buffer.concat(chunks),
    overflowed,
    readFailed: null,
  };
}
