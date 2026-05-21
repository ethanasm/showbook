/**
 * Unit tests for the SSE parser + scan runner. Pure logic, no RN imports
 * — exercised under node:test against an in-memory ReadableStream.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  createSseParserState,
  decodeScanEvent,
  feedSseChunk,
  runGmailScan,
} from '../gmail-import/scan';

describe('feedSseChunk', () => {
  it('returns no events for an empty chunk', () => {
    const state = createSseParserState();
    assert.deepEqual(feedSseChunk(state, ''), []);
    assert.equal(state.buffer, '');
  });

  it('parses a complete event in one chunk', () => {
    const state = createSseParserState();
    const events = feedSseChunk(
      state,
      'event: progress\ndata: {"phase":"searching","processed":0,"total":0,"found":0}\n\n',
    );
    assert.equal(events.length, 1);
    assert.equal(events[0].event, 'progress');
    assert.equal(
      events[0].data,
      '{"phase":"searching","processed":0,"total":0,"found":0}',
    );
    assert.equal(state.buffer, '');
  });

  it('parses multiple events in one chunk', () => {
    const state = createSseParserState();
    const events = feedSseChunk(
      state,
      [
        'event: progress',
        'data: {"phase":"searching","processed":0,"total":0,"found":0}',
        '',
        'event: progress',
        'data: {"phase":"processing","processed":8,"total":24,"found":2}',
        '',
        '',
      ].join('\n'),
    );
    assert.equal(events.length, 2);
    assert.equal(events[0].event, 'progress');
    assert.equal(events[1].event, 'progress');
    assert.match(events[1].data, /"processed":8/);
  });

  it('buffers a partial event across chunks', () => {
    const state = createSseParserState();
    const out1 = feedSseChunk(state, 'event: prog');
    assert.deepEqual(out1, []);
    const out2 = feedSseChunk(state, 'ress\ndata: {"phase":"searching"');
    assert.deepEqual(out2, []);
    const out3 = feedSseChunk(state, ',"processed":0,"total":0,"found":0}\n\n');
    assert.equal(out3.length, 1);
    assert.equal(out3[0].event, 'progress');
  });

  it('normalises CRLF to LF', () => {
    const state = createSseParserState();
    const events = feedSseChunk(
      state,
      'event: done\r\ndata: {"tickets":[],"truncated":false}\r\n\r\n',
    );
    assert.equal(events.length, 1);
    assert.equal(events[0].event, 'done');
  });

  it('ignores trailing whitespace before colon on event/data', () => {
    const state = createSseParserState();
    const events = feedSseChunk(
      state,
      'event: error\ndata: {"message":"boom"}\n\n',
    );
    assert.equal(events[0].data, '{"message":"boom"}');
  });

  it('drops blocks with no data lines', () => {
    const state = createSseParserState();
    const events = feedSseChunk(state, ': comment-only\n\n');
    assert.deepEqual(events, []);
  });
});

describe('decodeScanEvent', () => {
  it('decodes a progress event', () => {
    const decoded = decodeScanEvent({
      event: 'progress',
      data: '{"phase":"processing","processed":5,"total":10,"found":1}',
    });
    assert.equal(decoded?.kind, 'progress');
    if (decoded?.kind === 'progress') {
      assert.equal(decoded.payload.phase, 'processing');
      assert.equal(decoded.payload.processed, 5);
      assert.equal(decoded.payload.found, 1);
    }
  });

  it('decodes a done event with tickets', () => {
    const decoded = decodeScanEvent({
      event: 'done',
      data: JSON.stringify({
        tickets: [
          {
            gmailMessageId: 'm1',
            headliner: 'Phoebe Bridgers',
            production_name: null,
            venue_name: 'The Anthem',
            venue_city: 'Washington',
            venue_state: 'DC',
            date: '2026-06-12',
            seat: 'GA',
            price: '85.50',
            ticket_count: 2,
            kind_hint: 'concert',
            confidence: 'high',
          },
        ],
        truncated: false,
      }),
    });
    assert.equal(decoded?.kind, 'done');
    if (decoded?.kind === 'done') {
      assert.equal(decoded.payload.tickets.length, 1);
      assert.equal(decoded.payload.tickets[0].headliner, 'Phoebe Bridgers');
      assert.equal(decoded.payload.truncated, false);
    }
  });

  it('decodes an error event', () => {
    const decoded = decodeScanEvent({
      event: 'error',
      data: '{"message":"Scan failed"}',
    });
    assert.equal(decoded?.kind, 'error');
    if (decoded?.kind === 'error') {
      assert.equal(decoded.payload.message, 'Scan failed');
    }
  });

  it('returns null for unrecognised event names', () => {
    assert.equal(decodeScanEvent({ event: 'heartbeat', data: '{}' }), null);
  });

  it('returns null for non-JSON data', () => {
    assert.equal(decodeScanEvent({ event: 'progress', data: 'not json' }), null);
  });
});

function makeSseResponse(chunks: string[]): Response {
  // ReadableStream of UTF-8 encoded chunks. Lets us simulate the server
  // emitting events one at a time and verify the parser handles
  // incremental delivery.
  const encoder = new TextEncoder();
  let i = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[i++]));
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

describe('runGmailScan', () => {
  const baseOpts = {
    apiUrl: 'https://showbook.example.com',
    accessToken: 'gmail-access-token',
    sessionToken: 'showbook-jwt',
  } as const;

  it('passes the access token in the request body and bearer in header', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;
    const fetchImpl = ((url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedInit = init;
      return Promise.resolve(
        makeSseResponse([
          'event: done\ndata: {"tickets":[],"truncated":false}\n\n',
        ]),
      );
    }) as unknown as typeof fetch;

    await runGmailScan({ ...baseOpts, fetchImpl });

    assert.equal(capturedUrl, 'https://showbook.example.com/api/gmail/scan');
    assert.equal(capturedInit?.method, 'POST');
    const headers = capturedInit?.headers as Record<string, string>;
    assert.equal(headers.Authorization, 'Bearer showbook-jwt');
    assert.equal(headers['Content-Type'], 'application/json');
    const body = JSON.parse(capturedInit?.body as string);
    assert.deepEqual(body, { accessToken: 'gmail-access-token' });
  });

  it('streams progress updates and resolves with the final result', async () => {
    const progressEvents: Array<{ processed: number; total: number; found: number }> = [];
    const fetchImpl = (() =>
      Promise.resolve(
        makeSseResponse([
          'event: progress\ndata: {"phase":"searching","processed":0,"total":0,"found":0}\n\n',
          'event: progress\ndata: {"phase":"processing","processed":8,"total":16,"found":2}\n\n',
          'event: progress\ndata: {"phase":"processing","processed":16,"total":16,"found":4}\n\n',
          'event: done\ndata: {"tickets":[{"gmailMessageId":"m1","headliner":"X","production_name":null,"venue_name":null,"venue_city":null,"venue_state":null,"date":null,"seat":null,"price":null,"ticket_count":null,"kind_hint":null,"confidence":"low"}],"truncated":false}\n\n',
        ]),
      )) as unknown as typeof fetch;

    const result = await runGmailScan({
      ...baseOpts,
      fetchImpl,
      onProgress: (p) =>
        progressEvents.push({ processed: p.processed, total: p.total, found: p.found }),
    });

    assert.equal(progressEvents.length, 3);
    assert.equal(progressEvents[2].found, 4);
    assert.equal(result.tickets.length, 1);
    assert.equal(result.truncated, false);
  });

  it('rejects when the server emits an error event', async () => {
    const fetchImpl = (() =>
      Promise.resolve(
        makeSseResponse([
          'event: error\ndata: {"message":"Groq blew up"}\n\n',
        ]),
      )) as unknown as typeof fetch;

    await assert.rejects(
      () => runGmailScan({ ...baseOpts, fetchImpl }),
      /Groq blew up/,
    );
  });

  it('rewrites an upstream Gmail 401 into a reconnect hint', async () => {
    const fetchImpl = (() =>
      Promise.resolve(
        makeSseResponse([
          'event: error\ndata: {"message":"Gmail search failed","status":401}\n\n',
        ]),
      )) as unknown as typeof fetch;
    await assert.rejects(
      () => runGmailScan({ ...baseOpts, fetchImpl }),
      /reconnect/i,
    );
  });

  it('rewrites an upstream Gmail 5xx into a retry hint with the code', async () => {
    const fetchImpl = (() =>
      Promise.resolve(
        makeSseResponse([
          'event: error\ndata: {"message":"Gmail search failed","status":503}\n\n',
        ]),
      )) as unknown as typeof fetch;
    await assert.rejects(
      () => runGmailScan({ ...baseOpts, fetchImpl }),
      /503/,
    );
  });

  it('rejects with a friendly message on 429', async () => {
    const fetchImpl = (() =>
      Promise.resolve(
        new Response('Too Many Requests', { status: 429 }),
      )) as unknown as typeof fetch;
    await assert.rejects(
      () => runGmailScan({ ...baseOpts, fetchImpl }),
      /try again/i,
    );
  });

  it('rejects on 401 with a sign-in hint', async () => {
    const fetchImpl = (() =>
      Promise.resolve(
        new Response('Unauthorized', { status: 401 }),
      )) as unknown as typeof fetch;
    await assert.rejects(
      () => runGmailScan({ ...baseOpts, fetchImpl }),
      /sign out/i,
    );
  });

  it('rejects on other non-OK statuses', async () => {
    const fetchImpl = (() =>
      Promise.resolve(
        new Response('Internal Server Error', { status: 500 }),
      )) as unknown as typeof fetch;
    await assert.rejects(
      () => runGmailScan({ ...baseOpts, fetchImpl }),
      /500/,
    );
  });

  it('rejects when the stream ends without a done event', async () => {
    const fetchImpl = (() =>
      Promise.resolve(
        makeSseResponse([
          'event: progress\ndata: {"phase":"searching","processed":0,"total":0,"found":0}\n\n',
        ]),
      )) as unknown as typeof fetch;
    await assert.rejects(
      () => runGmailScan({ ...baseOpts, fetchImpl }),
      /ended without a result/,
    );
  });
});
