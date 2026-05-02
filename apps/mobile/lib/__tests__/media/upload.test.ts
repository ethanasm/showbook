/**
 * M4 upload pipeline tests.
 *
 * The pipeline talks to the server via an injected `UploadServer` and PUTs
 * to S3 via an injected `fetchImpl`. Both are stubbed here so the test
 * never opens a network socket.
 *
 * Coverage:
 *  - happy path: intent → S3 PUT → confirm, with the request shape asserted
 *    at every step
 *  - per-file progress callbacks fire monotonically 0 → 1
 *  - retry with exponential backoff on 5xx + transient network errors
 *  - 402 surfaces as OverQuotaError (NOT a generic UploadHttpError)
 *  - cancel during upload aborts the in-flight PUT
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  uploadFile,
  OverQuotaError,
  UploadCancelledError,
  UploadHttpError,
  type SelectedFile,
  type UploadServer,
  type UploadIntentInput,
  type UploadIntentResult,
  type MediaAssetDto,
} from '../../media/upload';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function fakePhoto(overrides: Partial<SelectedFile> = {}): SelectedFile {
  return {
    uri: 'file:///private/photo.jpg',
    mediaType: 'photo',
    mimeType: 'image/jpeg',
    bytes: 4_096,
    width: 1024,
    height: 768,
    ...overrides,
  };
}

function fakeIntent(): UploadIntentResult {
  return {
    assetId: 'asset-1',
    targets: [
      {
        name: 'source',
        key: 'showbook/u/shows/s/photos/asset-1/source.webp',
        mimeType: 'image/jpeg',
        uploadUrl: 'https://s3.example.com/upload?sig=abc',
      },
    ],
  };
}

function fakeAsset(overrides: Partial<MediaAssetDto> = {}): MediaAssetDto {
  return {
    id: 'asset-1',
    showId: 'show-1',
    mediaType: 'photo',
    status: 'ready',
    caption: null,
    bytes: 4_096,
    performerIds: [],
    urls: { source: 'https://cdn.example.com/showbook/asset-1/source.webp' },
    ...overrides,
  };
}

interface StubServer extends UploadServer {
  intentCalls: UploadIntentInput[];
  completeCalls: Array<{ assetId: string }>;
}

function stubServer(opts: {
  intent?: () => Promise<UploadIntentResult>;
  complete?: (input: { assetId: string }) => Promise<MediaAssetDto>;
} = {}): StubServer {
  const intentCalls: UploadIntentInput[] = [];
  const completeCalls: Array<{ assetId: string }> = [];
  return {
    intentCalls,
    completeCalls,
    createUploadIntent: async (input) => {
      intentCalls.push(input);
      return opts.intent ? opts.intent() : fakeIntent();
    },
    completeUpload: async (input) => {
      completeCalls.push(input);
      return opts.complete ? opts.complete(input) : fakeAsset();
    },
  };
}

interface FetchCall {
  url: string;
  init?: RequestInit;
}

function makeFetch(handlers: Array<(url: string, init?: RequestInit) => Promise<Response> | Response>): {
  fetchImpl: typeof globalThis.fetch;
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  let i = 0;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    calls.push({ url, init });
    const handler = handlers[Math.min(i, handlers.length - 1)];
    i++;
    if (!handler) throw new Error('no fetch handler');
    return handler(url, init);
  }) as typeof globalThis.fetch;
  return { fetchImpl, calls };
}

function okResponse(body: BodyInit | null = null, init: ResponseInit = { status: 200 }): Response {
  return new Response(body, init);
}

function emptyBlob(size = 4): Blob {
  return new Blob([new Uint8Array(size)], { type: 'image/jpeg' });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('uploadFile — happy path', () => {
  it('chains picker → presigned URL → S3 PUT → confirm', async () => {
    const server = stubServer();
    const { fetchImpl, calls } = makeFetch([
      // Step A: read source bytes from the file:// uri
      async () => okResponse(emptyBlob()),
      // Step B: PUT to S3
      async () => okResponse(null, { status: 200 }),
    ]);

    const file = fakePhoto({ caption: 'Cool moment' });
    const result = await uploadFile(file, {
      server,
      showId: 'show-1',
      fetchImpl,
      sleepImpl: async () => undefined,
    });

    // Intent shape
    assert.equal(server.intentCalls.length, 1);
    const intent = server.intentCalls[0]!;
    assert.equal(intent.showId, 'show-1');
    assert.equal(intent.mediaType, 'photo');
    assert.equal(intent.mimeType, 'image/jpeg');
    assert.equal(intent.sourceBytes, 4_096);
    assert.equal(intent.storedBytes, 4_096);
    assert.equal(intent.caption, 'Cool moment');
    assert.equal(intent.variants.length, 1);
    assert.equal(intent.variants[0]?.name, 'source');
    assert.equal(intent.variants[0]?.bytes, 4_096);

    // Two fetches: read file, then PUT
    assert.equal(calls.length, 2);
    assert.equal(calls[0]?.url, 'file:///private/photo.jpg');
    assert.equal(calls[1]?.url, 'https://s3.example.com/upload?sig=abc');
    assert.equal((calls[1]?.init as RequestInit | undefined)?.method, 'PUT');
    const headers = (calls[1]?.init as RequestInit | undefined)?.headers as
      | Record<string, string>
      | undefined;
    assert.equal(headers?.['Content-Type'], 'image/jpeg');

    // Confirm
    assert.equal(server.completeCalls.length, 1);
    assert.equal(server.completeCalls[0]?.assetId, 'asset-1');

    assert.equal(result.id, 'asset-1');
    assert.equal(result.status, 'ready');
  });
});

describe('uploadFile — progress', () => {
  it('reports progress monotonically from 0 to 1', async () => {
    const server = stubServer();
    const { fetchImpl } = makeFetch([
      async () => okResponse(emptyBlob()),
      async () => okResponse(null, { status: 200 }),
    ]);

    const progress: number[] = [];
    await uploadFile(fakePhoto(), {
      server,
      showId: 'show-1',
      fetchImpl,
      sleepImpl: async () => undefined,
      onProgress: (f) => progress.push(f),
    });

    assert.ok(progress.length >= 2, `expected at least 2 progress events, got ${progress.length}`);
    assert.equal(progress[0], 0);
    assert.equal(progress[progress.length - 1], 1);
    for (let i = 1; i < progress.length; i++) {
      assert.ok(
        progress[i]! >= progress[i - 1]!,
        `expected progress to be non-decreasing at index ${i}: ${progress[i - 1]} → ${progress[i]}`,
      );
      assert.ok(progress[i]! >= 0 && progress[i]! <= 1);
    }
  });
});

describe('uploadFile — retry with exponential backoff', () => {
  it('retries 5xx PUT failures and then succeeds', async () => {
    const server = stubServer();
    let putAttempts = 0;
    const { fetchImpl, calls } = makeFetch([
      // file read
      async () => okResponse(emptyBlob()),
      // PUT attempts: two 503s then a 200
      async () => {
        putAttempts++;
        return okResponse(null, { status: 503 });
      },
      async () => {
        putAttempts++;
        return okResponse(null, { status: 503 });
      },
      async () => {
        putAttempts++;
        return okResponse(null, { status: 200 });
      },
    ]);

    const sleeps: number[] = [];
    await uploadFile(fakePhoto(), {
      server,
      showId: 'show-1',
      fetchImpl,
      baseBackoffMs: 10,
      sleepImpl: async (ms) => {
        sleeps.push(ms);
      },
    });

    assert.equal(putAttempts, 3);
    // Two retries between three attempts → two sleeps with exponential growth
    assert.equal(sleeps.length, 2);
    assert.equal(sleeps[0], 10); // base * 2^0
    assert.equal(sleeps[1], 20); // base * 2^1
    // 4 fetches: 1 file read + 3 PUTs
    assert.equal(calls.length, 4);
  });

  it('retries network errors (TypeError) on the PUT step', async () => {
    const server = stubServer();
    let putAttempts = 0;
    const { fetchImpl } = makeFetch([
      async () => okResponse(emptyBlob()),
      async () => {
        putAttempts++;
        throw new TypeError('Network request failed');
      },
      async () => {
        putAttempts++;
        return okResponse(null, { status: 200 });
      },
    ]);

    await uploadFile(fakePhoto(), {
      server,
      showId: 'show-1',
      fetchImpl,
      baseBackoffMs: 1,
      sleepImpl: async () => undefined,
    });

    assert.equal(putAttempts, 2);
  });

  it('gives up after maxRetries on persistent 5xx and surfaces the HTTP error', async () => {
    const server = stubServer();
    let attempts = 0;
    const { fetchImpl } = makeFetch([
      async () => okResponse(emptyBlob()),
      async () => {
        attempts++;
        return okResponse(null, { status: 502 });
      },
    ]);

    await assert.rejects(
      uploadFile(fakePhoto(), {
        server,
        showId: 'show-1',
        fetchImpl,
        maxRetries: 2,
        baseBackoffMs: 1,
        sleepImpl: async () => undefined,
      }),
      (err) => err instanceof UploadHttpError && err.status === 502 && err.step === 'put',
    );
    // 2 retries → 3 attempts total
    assert.equal(attempts, 3);
  });
});

describe('uploadFile — over-quota signal', () => {
  it('surfaces 402 from the PUT step as OverQuotaError', async () => {
    const server = stubServer();
    const { fetchImpl } = makeFetch([
      async () => okResponse(emptyBlob()),
      async () => okResponse(null, { status: 402 }),
    ]);

    await assert.rejects(
      uploadFile(fakePhoto(), {
        server,
        showId: 'show-1',
        fetchImpl,
        sleepImpl: async () => undefined,
      }),
      (err) => err instanceof OverQuotaError,
    );
  });

  it('does NOT retry an over-quota response', async () => {
    const server = stubServer();
    let putAttempts = 0;
    const { fetchImpl } = makeFetch([
      async () => okResponse(emptyBlob()),
      async () => {
        putAttempts++;
        return okResponse(null, { status: 402 });
      },
    ]);

    await assert.rejects(
      uploadFile(fakePhoto(), {
        server,
        showId: 'show-1',
        fetchImpl,
        baseBackoffMs: 1,
        sleepImpl: async () => undefined,
      }),
      OverQuotaError,
    );
    assert.equal(putAttempts, 1);
  });

  it('maps a tRPC BAD_REQUEST quota message to OverQuotaError (not a generic error)', async () => {
    const server: UploadServer = {
      createUploadIntent: async () => {
        // tRPC clients raise a plain Error with the server's message text.
        const err = new Error('Your media storage is full');
        throw err;
      },
      completeUpload: async () => fakeAsset(),
    };

    await assert.rejects(
      uploadFile(fakePhoto(), {
        server,
        showId: 'show-1',
        sleepImpl: async () => undefined,
      }),
      (err) => err instanceof OverQuotaError && /storage is full/i.test(err.message),
    );
  });
});

describe('uploadFile — cancellation', () => {
  it('aborts the in-flight PUT when the signal fires mid-flight', async () => {
    const server = stubServer();
    const controller = new AbortController();

    const { fetchImpl } = makeFetch([
      async () => okResponse(emptyBlob()),
      // PUT: hangs until the signal aborts, then throws an AbortError
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal as AbortSignal | undefined;
          if (signal) {
            signal.addEventListener('abort', () => {
              const err = new Error('Aborted') as Error & { name: string };
              err.name = 'AbortError';
              reject(err);
            });
          }
        }),
    ]);

    const promise = uploadFile(fakePhoto(), {
      server,
      showId: 'show-1',
      fetchImpl,
      signal: controller.signal,
      sleepImpl: async () => undefined,
    });
    // Let the file-read + PUT start
    await new Promise((r) => setTimeout(r, 0));
    controller.abort();
    await assert.rejects(promise, UploadCancelledError);
    // confirm step never ran
    assert.equal(server.completeCalls.length, 0);
  });

  it('throws UploadCancelledError before issuing intent if signal is already aborted', async () => {
    const server = stubServer();
    const controller = new AbortController();
    controller.abort();

    await assert.rejects(
      uploadFile(fakePhoto(), {
        server,
        showId: 'show-1',
        signal: controller.signal,
        sleepImpl: async () => undefined,
      }),
      UploadCancelledError,
    );
    assert.equal(server.intentCalls.length, 0);
  });
});
