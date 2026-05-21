/**
 * M4 upload pipeline tests.
 *
 * The pipeline talks to the server via an injected `UploadServer` and PUTs
 * to S3 via an injected `putImpl`. Both are stubbed here so the test never
 * opens a network socket.
 *
 * Coverage:
 *  - happy path: intent → S3 PUT → confirm, with the request shape asserted
 *    at every step
 *  - per-file progress callbacks fire monotonically 0 → 1
 *  - retry with exponential backoff on 5xx + transient network errors
 *  - 402 surfaces as OverQuotaError (NOT a generic UploadHttpError)
 *  - cancel during upload aborts the in-flight PUT
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  uploadFile,
  OverQuotaError,
  UploadCancelledError,
  UploadHttpError,
  type PutFileFn,
  type PutResult,
  type SelectedFile,
  type UploadServer,
  type UploadTarget,
  type UploadIntentInput,
  type UploadIntentResult,
  type MediaAssetDto,
} from '../../media/upload';
import {
  setMobileTelemetryLogger,
  __resetTelemetryForTests,
  type ClientEventPayload,
} from '../../telemetry';

beforeEach(() => __resetTelemetryForTests());

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

interface PutCall {
  target: UploadTarget;
  fileUri: string;
  signal: AbortSignal | undefined;
}

type PutHandler = (call: PutCall) => Promise<PutResult> | PutResult;

/**
 * Build a `putImpl` that returns successive results per call. If only
 * one handler is provided, it's reused for every call. Records each call
 * so tests can assert on URL / mime / signal state.
 */
function makePut(handlers: PutHandler[]): {
  putImpl: PutFileFn;
  calls: PutCall[];
} {
  const calls: PutCall[] = [];
  let i = 0;
  const putImpl: PutFileFn = async (args) => {
    calls.push({ target: args.target, fileUri: args.fileUri, signal: args.signal });
    const handler = handlers[Math.min(i, handlers.length - 1)];
    i++;
    if (!handler) throw new Error('no put handler');
    return handler({ target: args.target, fileUri: args.fileUri, signal: args.signal });
  };
  return { putImpl, calls };
}

function okPut(): PutHandler {
  return () => ({ status: 200, bodyPreview: null });
}

function errPut(status: number, body: string | null = null): PutHandler {
  return () => ({ status, bodyPreview: body });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('uploadFile — happy path', () => {
  it('chains picker → presigned URL → S3 PUT → confirm', async () => {
    const server = stubServer();
    const { putImpl, calls } = makePut([okPut()]);

    const file = fakePhoto({ caption: 'Cool moment' });
    const result = await uploadFile(file, {
      server,
      showId: 'show-1',
      putImpl,
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

    // One PUT to the presigned URL, carrying the source file uri and
    // explicit mime that the URL was signed for.
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.fileUri, 'file:///private/photo.jpg');
    assert.equal(calls[0]?.target.uploadUrl, 'https://s3.example.com/upload?sig=abc');
    assert.equal(calls[0]?.target.mimeType, 'image/jpeg');

    // Confirm
    assert.equal(server.completeCalls.length, 1);
    assert.equal(server.completeCalls[0]?.assetId, 'asset-1');

    assert.equal(result.id, 'asset-1');
    assert.equal(result.status, 'ready');
  });

  it('passes HEIC photos straight through to the upload intent without JS-side re-encode', async () => {
    // Earlier revisions ran HEIC through expo-image-manipulator first so
    // Chrome / Firefox could render the stored file. That step crashed
    // iOS natively the moment the OTA bundle finally caught up to PR
    // #319 — the user's app force-closed on every upload tap. Now the
    // native upload task PUTs the raw HEIC to R2 (signed Content-Type
    // honored verbatim) and the web client decodes HEIC for display via
    // `heic-to`. The regression guard here is that the intent the
    // server sees matches the original picker output — no JPEG swap.
    const server = stubServer();
    const { putImpl, calls } = makePut([okPut()]);

    const heicFile: SelectedFile = {
      uri: 'file:///private/photo.HEIC',
      mediaType: 'photo',
      mimeType: 'image/heic',
      bytes: 2_276_668,
      width: 4032,
      height: 3024,
    };

    await uploadFile(heicFile, {
      server,
      showId: 'show-1',
      putImpl,
      sleepImpl: async () => undefined,
    });

    assert.equal(server.intentCalls.length, 1);
    assert.equal(server.intentCalls[0]?.mimeType, 'image/heic');
    assert.equal(server.intentCalls[0]?.sourceBytes, 2_276_668);
    assert.equal(server.intentCalls[0]?.variants[0]?.mimeType, 'image/heic');
    assert.equal(calls[0]?.fileUri, 'file:///private/photo.HEIC');
  });

  it('hands the original file URI to the PUT step rather than buffering bytes in JS', async () => {
    // Regression: the pre-PR fetch+Blob path loaded the entire file into
    // JS memory just to PUT it. The native upload task streams from disk
    // — the test confirms we pass through the file:// URI and never read
    // it ourselves.
    const server = stubServer();
    const { putImpl, calls } = makePut([okPut()]);

    const file = fakePhoto({ uri: 'file:///some/path/IMG_4242.jpg', bytes: 12_345_678 });
    await uploadFile(file, {
      server,
      showId: 'show-1',
      putImpl,
      sleepImpl: async () => undefined,
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.fileUri, 'file:///some/path/IMG_4242.jpg');
  });
});

describe('uploadFile — progress', () => {
  it('reports progress monotonically from 0 to 1', async () => {
    const server = stubServer();
    const { putImpl } = makePut([okPut()]);

    const progress: number[] = [];
    await uploadFile(fakePhoto(), {
      server,
      showId: 'show-1',
      putImpl,
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
    const { putImpl, calls } = makePut([
      () => {
        putAttempts++;
        return { status: 503, bodyPreview: null };
      },
      () => {
        putAttempts++;
        return { status: 503, bodyPreview: null };
      },
      () => {
        putAttempts++;
        return { status: 200, bodyPreview: null };
      },
    ]);

    const sleeps: number[] = [];
    await uploadFile(fakePhoto(), {
      server,
      showId: 'show-1',
      putImpl,
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
    assert.equal(calls.length, 3);
  });

  it('retries network errors (TypeError) on the PUT step', async () => {
    const server = stubServer();
    let putAttempts = 0;
    const { putImpl } = makePut([
      () => {
        putAttempts++;
        throw new TypeError('Network request failed');
      },
      () => {
        putAttempts++;
        return { status: 200, bodyPreview: null };
      },
    ]);

    await uploadFile(fakePhoto(), {
      server,
      showId: 'show-1',
      putImpl,
      baseBackoffMs: 1,
      sleepImpl: async () => undefined,
    });

    assert.equal(putAttempts, 2);
  });

  it('gives up after maxRetries on persistent 5xx and surfaces the HTTP error', async () => {
    const server = stubServer();
    let attempts = 0;
    const { putImpl } = makePut([
      () => {
        attempts++;
        return { status: 502, bodyPreview: null };
      },
    ]);

    await assert.rejects(
      uploadFile(fakePhoto(), {
        server,
        showId: 'show-1',
        putImpl,
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
    const { putImpl } = makePut([errPut(402)]);

    await assert.rejects(
      uploadFile(fakePhoto(), {
        server,
        showId: 'show-1',
        putImpl,
        sleepImpl: async () => undefined,
      }),
      (err) => err instanceof OverQuotaError,
    );
  });

  it('does NOT retry an over-quota response', async () => {
    const server = stubServer();
    let putAttempts = 0;
    const { putImpl } = makePut([
      () => {
        putAttempts++;
        return { status: 402, bodyPreview: null };
      },
    ]);

    await assert.rejects(
      uploadFile(fakePhoto(), {
        server,
        showId: 'show-1',
        putImpl,
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

describe('uploadFile — telemetry on PUT failure', () => {
  it('captures R2 status + response body preview when PUT returns non-2xx', async () => {
    const reports: ClientEventPayload[] = [];
    setMobileTelemetryLogger((p) => reports.push(p));

    const server = stubServer();
    const r2ErrorBody =
      '<?xml version="1.0" encoding="UTF-8"?><Error><Code>SignatureDoesNotMatch</Code><Message>The request signature we calculated does not match the signature you provided.</Message></Error>';
    const { putImpl } = makePut([errPut(403, r2ErrorBody)]);

    await assert.rejects(
      uploadFile(fakePhoto(), {
        server,
        showId: 'show-1',
        putImpl,
        maxRetries: 0,
        sleepImpl: async () => undefined,
      }),
      (err) => err instanceof UploadHttpError && err.status === 403 && err.step === 'put',
    );

    // Lifecycle markers (upload.start, upload.failed_at) also fire, so
    // filter to the specific failure event we care about. Telemetry
    // payload includes the status, the host (so ops know which R2
    // endpoint is failing), the storage key, and a body preview so the
    // actual error code (SignatureDoesNotMatch vs AccessDenied vs …) is
    // visible in Axiom without round-tripping back to the user.
    const putReports = reports.filter((r) => r.event === 'upload.put.failed');
    assert.equal(putReports.length, 1);
    const report = putReports[0]!;
    assert.equal(report.event, 'upload.put.failed');
    assert.equal(report.level, 'error');
    assert.equal(report.message, 'R2 PUT 403');
    const ctx = report.context as Record<string, unknown>;
    assert.equal(ctx.status, 403);
    assert.equal(ctx.host, 's3.example.com');
    assert.equal(ctx.key, 'showbook/u/shows/s/photos/asset-1/source.webp');
    assert.equal(ctx.mimeType, 'image/jpeg');
    assert.ok(
      typeof ctx.bodyPreview === 'string' && ctx.bodyPreview.includes('SignatureDoesNotMatch'),
      `expected bodyPreview to include the R2 error code, got: ${ctx.bodyPreview}`,
    );
  });

  it('reports a network error on PUT with the underlying error message', async () => {
    const reports: ClientEventPayload[] = [];
    setMobileTelemetryLogger((p) => reports.push(p));

    const server = stubServer();
    const { putImpl } = makePut([
      () => {
        throw new TypeError('Network request failed');
      },
    ]);

    await assert.rejects(
      uploadFile(fakePhoto(), {
        server,
        showId: 'show-1',
        putImpl,
        maxRetries: 0,
        baseBackoffMs: 1,
        sleepImpl: async () => undefined,
      }),
    );

    const networkReport = reports.find((r) => r.event === 'upload.put.network_error');
    assert.ok(networkReport, 'expected an upload.put.network_error report');
    assert.equal(networkReport?.message, 'Network request failed');
  });

  it('does NOT report when the user cancels the upload (AbortError is not a failure)', async () => {
    const reports: ClientEventPayload[] = [];
    setMobileTelemetryLogger((p) => reports.push(p));

    const server = stubServer();
    const controller = new AbortController();
    const { putImpl } = makePut([
      ({ signal }) =>
        new Promise<PutResult>((_resolve, reject) => {
          signal?.addEventListener('abort', () => {
            const err = new Error('Aborted') as Error & { name: string };
            err.name = 'AbortError';
            reject(err);
          });
        }),
    ]);

    const p = uploadFile(fakePhoto(), {
      server,
      showId: 'show-1',
      putImpl,
      signal: controller.signal,
      sleepImpl: async () => undefined,
    });
    await new Promise((r) => setTimeout(r, 0));
    controller.abort();
    await assert.rejects(p, UploadCancelledError);

    // The lifecycle marker `upload.start` may fire before the abort
    // hits, but neither `upload.put.failed`, `upload.put.network_error`,
    // nor `upload.failed_at` should — a user cancel isn't a failure.
    const failureEvents = reports.filter(
      (r) =>
        r.event === 'upload.put.failed' ||
        r.event === 'upload.put.network_error' ||
        r.event === 'upload.failed_at',
    );
    assert.equal(
      failureEvents.length,
      0,
      `cancellation should not generate a failure event, got: ${failureEvents.map((r) => r.event).join(', ')}`,
    );
  });
});

describe('uploadFile — lifecycle telemetry', () => {
  it('emits start → success markers on the happy path so Axiom can locate stuck uploads', async () => {
    const reports: ClientEventPayload[] = [];
    setMobileTelemetryLogger((p) => reports.push(p));

    const server = stubServer();
    const { putImpl } = makePut([okPut()]);

    await uploadFile(fakePhoto(), {
      server,
      showId: 'show-1',
      putImpl,
      sleepImpl: async () => undefined,
    });

    const events = reports.map((r) => r.event);
    assert.ok(events.includes('upload.start'), `missing upload.start, got: ${events.join(', ')}`);
    assert.ok(events.includes('upload.success'), `missing upload.success, got: ${events.join(', ')}`);

    const success = reports.find((r) => r.event === 'upload.success')!;
    const ctx = success.context as Record<string, unknown>;
    assert.equal(ctx.assetId, 'asset-1');
    assert.equal(typeof ctx.elapsedMs, 'number');
  });

  it('fires upload.failed_at with stage=intent when the server rejects the intent', async () => {
    const reports: ClientEventPayload[] = [];
    setMobileTelemetryLogger((p) => reports.push(p));

    const server: UploadServer = {
      createUploadIntent: async () => {
        throw new Error('Internal Server Error');
      },
      completeUpload: async () => fakeAsset(),
    };

    await assert.rejects(
      uploadFile(fakePhoto(), {
        server,
        showId: 'show-1',
        maxRetries: 0,
        sleepImpl: async () => undefined,
      }),
    );

    const failed = reports.find((r) => r.event === 'upload.failed_at');
    assert.ok(failed, 'expected a terminal upload.failed_at event');
    assert.equal((failed!.context as Record<string, unknown>).stage, 'intent');
  });

  it('fires upload.failed_at with stage=put when every retry of the PUT fails', async () => {
    const reports: ClientEventPayload[] = [];
    setMobileTelemetryLogger((p) => reports.push(p));

    const server = stubServer();
    const { putImpl } = makePut([errPut(500)]);

    await assert.rejects(
      uploadFile(fakePhoto(), {
        server,
        showId: 'show-1',
        putImpl,
        maxRetries: 0,
        baseBackoffMs: 1,
        sleepImpl: async () => undefined,
      }),
    );

    const failed = reports.find((r) => r.event === 'upload.failed_at');
    assert.ok(failed, 'expected a terminal upload.failed_at event');
    assert.equal((failed!.context as Record<string, unknown>).stage, 'put');
  });
});

describe('uploadFile — cancellation', () => {
  it('aborts the in-flight PUT when the signal fires mid-flight', async () => {
    const server = stubServer();
    const controller = new AbortController();

    const { putImpl } = makePut([
      ({ signal }) =>
        new Promise<PutResult>((_resolve, reject) => {
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
      putImpl,
      signal: controller.signal,
      sleepImpl: async () => undefined,
    });
    // Let the PUT start
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
