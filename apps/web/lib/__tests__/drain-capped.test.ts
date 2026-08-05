import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { drainCapped } from '../drain-capped';

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  });
}

const bytes = (n: number, fill = 7) => new Uint8Array(n).fill(fill);

describe('drainCapped', () => {
  it('returns the whole body when it is under the cap', async () => {
    const res = await drainCapped(streamOf([bytes(4), bytes(6)]), 100);
    assert.equal(res.overflowed, false);
    assert.equal(res.readFailed, null);
    assert.equal(res.body.length, 10);
  });

  it('accepts a body exactly at the cap', async () => {
    const res = await drainCapped(streamOf([bytes(10)]), 10);
    assert.equal(res.overflowed, false);
    assert.equal(res.body.length, 10);
  });

  it('flags overflow one byte past the cap', async () => {
    const res = await drainCapped(streamOf([bytes(11)]), 10);
    assert.equal(res.overflowed, true);
    assert.equal(res.body.length, 0);
  });

  it('does not retain an oversized body in memory', async () => {
    // 50 chunks of 1 MiB against a 1 KiB ceiling: the point of the helper is
    // that `body` stays empty rather than growing to the streamed size.
    const chunks = Array.from({ length: 50 }, () => bytes(1024 * 1024));
    const res = await drainCapped(streamOf(chunks), 1024);
    assert.equal(res.overflowed, true);
    assert.equal(res.body.length, 0);
  });

  it('drains the stream to completion even after overflowing', async () => {
    // Responding before the client finishes writing is what triggers iOS's
    // NSURLErrorCannotParseResponse, so every chunk must still be pulled.
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        if (pulled > 5) {
          controller.close();
          return;
        }
        controller.enqueue(bytes(1024));
      },
    });

    const res = await drainCapped(stream, 10);
    assert.equal(res.overflowed, true);
    assert.equal(pulled, 6, 'stream should be read to completion');
  });

  it('reports a mid-stream error instead of throwing', async () => {
    const boom = new Error('connection reset');
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes(4));
        controller.error(boom);
      },
    });

    const res = await drainCapped(stream, 100);
    assert.equal(res.readFailed, boom);
    assert.equal(res.body.length, 0);
  });

  it('treats a null body as empty', async () => {
    const res = await drainCapped(null, 100);
    assert.equal(res.overflowed, false);
    assert.equal(res.readFailed, null);
    assert.equal(res.body.length, 0);
  });

  it('skips empty chunks without counting them', async () => {
    const res = await drainCapped(streamOf([bytes(0), bytes(5), bytes(0)]), 5);
    assert.equal(res.overflowed, false);
    assert.equal(res.body.length, 5);
  });
});
