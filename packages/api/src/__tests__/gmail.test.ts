/**
 * Unit tests for gmail.ts. We swap globalThis.fetch with stubs that
 * return canned responses; no real Gmail API calls happen.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  GmailError,
  searchMessages,
  getMessageBody,
  getAttachment,
  buildTicketSearchQuery,
  buildBulkScanQueries,
} from '../gmail';

let origFetch: typeof globalThis.fetch;

beforeEach(() => {
  origFetch = globalThis.fetch;
});
afterEach(() => {
  globalThis.fetch = origFetch;
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function b64url(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
}

describe('GmailError', () => {
  it('captures message + status + detail', () => {
    const err = new GmailError('boom', 503, 'maint');
    assert.equal(err.name, 'GmailError');
    assert.equal(err.message, 'boom');
    assert.equal(err.status, 503);
    assert.equal(err.detail, 'maint');
    assert.ok(err instanceof Error);
  });
});

describe('buildTicketSearchQuery', () => {
  it('quotes both fields when supplied', () => {
    const q = buildTicketSearchQuery({ headliner: 'Phoebe', venue: 'Greek' });
    assert.match(q, /"Phoebe"/);
    assert.match(q, /"Greek"/);
    assert.match(q, /\(ticket OR confirmation OR order\)/);
  });

  it('omits absent fields', () => {
    const q = buildTicketSearchQuery({});
    assert.equal(q, '(ticket OR confirmation OR order)');
  });

  it('only headliner', () => {
    const q = buildTicketSearchQuery({ headliner: 'X' });
    assert.equal(q, '"X" (ticket OR confirmation OR order)');
  });
});

describe('buildBulkScanQueries', () => {
  it('returns four distinct queries', () => {
    const qs = buildBulkScanQueries();
    assert.equal(qs.length, 4);
    assert.equal(new Set(qs).size, 4);
  });

  it('includes ticket platform names in mid-priority query', () => {
    const qs = buildBulkScanQueries();
    assert.match(qs[1] ?? '', /ticketmaster/i);
    assert.match(qs[1] ?? '', /eventbrite/);
  });

  it('expands the exact-sender allowlist beyond the original four', () => {
    const exact = buildBulkScanQueries()[0] ?? '';
    // Original four
    assert.match(exact, /customer_support@email\.ticketmaster\.com/);
    assert.match(exact, /guestservices@axs\.com/);
    assert.match(exact, /order-support@frontgatetickets\.com/);
    assert.match(exact, /no-reply@e\.todaytix\.com/);
    // Newly added — these are the recall wins we're after
    assert.match(exact, /noreply@account\.ticketmaster\.com/);
    assert.match(exact, /order@axs\.com/);
    assert.match(exact, /noreply@dice\.fm/);
    assert.match(exact, /hello@dice\.fm/);
    assert.match(exact, /noreply@seetickets\.us/);
    assert.match(exact, /tickets@seatgeek\.com/);
    assert.match(exact, /orders@eventbrite\.com/);
    assert.match(exact, /service@telecharge\.com/);
    assert.match(exact, /noreply@email\.stubhub\.com/);
  });

  it('adds a sender-domain query that drops the subject-keyword requirement', () => {
    const domainQuery = buildBulkScanQueries()[3] ?? '';
    // Should be sender-domain based, no positive subject:() AND clause
    // (-subject:(...) exclusions are fine — only the AND-required keyword
    // filter is what hurts recall)
    assert.doesNotMatch(domainQuery, /(^|\s)subject:\(/);
    assert.match(domainQuery, /@dice\.fm/);
    assert.match(domainQuery, /@seatgeek\.com/);
    assert.match(domainQuery, /@eventbrite\.com/);
    // Still keeps the BULK_EXCLUSIONS guards
    assert.match(domainQuery, /-subject:\(museum/);
    assert.match(domainQuery, /-category:promotions/);
  });

  it('drops poster/merch from BULK_EXCLUSIONS to recover legit add-on confirmations', () => {
    const qs = buildBulkScanQueries();
    // The mid + broad + domain queries embed BULK_EXCLUSIONS. None of them
    // should still be filtering on poster/merch in subject.
    for (const q of [qs[1], qs[2], qs[3]]) {
      assert.ok(q);
      assert.doesNotMatch(q, /poster/);
      assert.doesNotMatch(q, /\bmerch\b/);
      assert.doesNotMatch(q, /merchandise/);
      // Sanity: real exclusions are still there
      assert.match(q, /museum/);
      assert.match(q, /shipping/);
      assert.match(q, /parking/);
    }
  });
});

describe('searchMessages', () => {
  it('returns parsed messages with cursor + total', async () => {
    globalThis.fetch = (async () =>
      jsonResponse({
        messages: [{ id: 'm1', threadId: 't1' }],
        nextPageToken: 'next',
        resultSizeEstimate: 1,
      })) as typeof globalThis.fetch;
    const result = await searchMessages('token', 'subject:foo', 5);
    assert.equal(result.messages.length, 1);
    assert.equal(result.nextPageToken, 'next');
    assert.equal(result.resultSizeEstimate, 1);
  });

  it('passes pageToken when provided', async () => {
    let capturedUrl = '';
    globalThis.fetch = (async (url: string) => {
      capturedUrl = url;
      return jsonResponse({ messages: [], resultSizeEstimate: 0 });
    }) as typeof globalThis.fetch;
    await searchMessages('token', 'q', 5, 'cursor-abc');
    assert.match(capturedUrl, /pageToken=cursor-abc/);
  });

  it('throws GmailError on non-OK', async () => {
    globalThis.fetch = (async () =>
      new Response('oops', { status: 500 })) as typeof globalThis.fetch;
    await assert.rejects(
      searchMessages('token', 'q'),
      (err: GmailError) => {
        assert.equal(err.name, 'GmailError');
        assert.equal(err.status, 500);
        assert.equal(err.detail, 'oops');
        return true;
      },
    );
  });

  it('handles missing fields with defaults', async () => {
    globalThis.fetch = (async () =>
      jsonResponse({})) as typeof globalThis.fetch;
    const r = await searchMessages('t', 'q');
    assert.deepEqual(r.messages, []);
    assert.equal(r.resultSizeEstimate, 0);
    assert.equal(r.nextPageToken, undefined);
  });

  it('retries on 429 (mocked timeout) and eventually returns', async (t) => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      if (calls === 1) return new Response('rl', { status: 429 });
      return jsonResponse({ messages: [], resultSizeEstimate: 0 });
    }) as typeof globalThis.fetch;
    // The 429 path sleeps 2s; allow extra wall-clock budget.
    t.diagnostic('429 retry path uses real 2s sleep');
    const r = await searchMessages('t', 'q');
    assert.equal(calls, 2);
    assert.deepEqual(r.messages, []);
  });
});

describe('getMessageBody', () => {
  it('parses subject/from/date and prefers plain text body', async () => {
    globalThis.fetch = (async () =>
      jsonResponse({
        payload: {
          headers: [
            { name: 'Subject', value: 'My ticket' },
            { name: 'From', value: 'sender@example.com' },
            { name: 'Date', value: 'Mon, 1 Jan 2026 00:00 +0000' },
          ],
          mimeType: 'text/plain',
          body: { data: b64url('A'.repeat(150)) },
        },
      })) as typeof globalThis.fetch;
    const r = await getMessageBody('token', 'mid-1');
    assert.equal(r.subject, 'My ticket');
    assert.equal(r.from, 'sender@example.com');
    assert.match(r.date, /2026/);
    assert.equal(r.body, 'A'.repeat(150));
  });

  it('falls back to stripped HTML when plain is short', async () => {
    globalThis.fetch = (async () =>
      jsonResponse({
        payload: {
          headers: [],
          mimeType: 'multipart/alternative',
          parts: [
            {
              mimeType: 'text/plain',
              body: { data: b64url('short') },
            },
            {
              mimeType: 'text/html',
              body: {
                data: b64url(
                  '<p>Hello <b>world</b></p>' +
                    '<style>x{}</style>' +
                    '<script>x()</script>' +
                    '<div>line two</div>',
                ),
              },
            },
          ],
        },
      })) as typeof globalThis.fetch;
    const r = await getMessageBody('token', 'mid-2');
    assert.match(r.body, /Hello world/);
    // Match opening tags with optional attributes / case variants so a smarter
    // payload can't slip through the assertion (e.g. `<SCRIPT>` or `<script `).
    assert.doesNotMatch(r.body, /<style\b[^>]*>/i);
    assert.doesNotMatch(r.body, /<script\b[^>]*>/i);
  });

  it('walks nested parts recursively', async () => {
    globalThis.fetch = (async () =>
      jsonResponse({
        payload: {
          headers: [],
          mimeType: 'multipart/mixed',
          parts: [
            {
              mimeType: 'multipart/alternative',
              parts: [
                {
                  mimeType: 'text/plain',
                  body: { data: b64url('B'.repeat(200)) },
                },
              ],
            },
          ],
        },
      })) as typeof globalThis.fetch;
    const r = await getMessageBody('token', 'mid-3');
    assert.equal(r.body, 'B'.repeat(200));
  });

  it('throws GmailError on non-OK', async () => {
    globalThis.fetch = (async () =>
      new Response('nope', { status: 404 })) as typeof globalThis.fetch;
    await assert.rejects(
      getMessageBody('token', 'mid-4'),
      (err: GmailError) => {
        assert.equal(err.status, 404);
        return true;
      },
    );
  });

  it('handles missing headers gracefully', async () => {
    globalThis.fetch = (async () =>
      jsonResponse({
        payload: {
          headers: [],
          mimeType: 'text/plain',
        },
      })) as typeof globalThis.fetch;
    const r = await getMessageBody('token', 'mid-5');
    assert.equal(r.subject, '');
    assert.equal(r.from, '');
    assert.equal(r.date, '');
    assert.equal(r.body, '');
  });

  it('returns empty attachments[] for plain bodies', async () => {
    globalThis.fetch = (async () =>
      jsonResponse({
        payload: {
          headers: [],
          mimeType: 'text/plain',
          body: { data: b64url('plain body') },
        },
      })) as typeof globalThis.fetch;
    const r = await getMessageBody('token', 'mid-noatt');
    assert.deepEqual(r.attachments, []);
  });

  it('collects PDF attachment refs but ignores non-PDF mimes', async () => {
    globalThis.fetch = (async () =>
      jsonResponse({
        payload: {
          headers: [],
          mimeType: 'multipart/mixed',
          parts: [
            {
              mimeType: 'text/html',
              body: { data: b64url('<p>see attached</p>') },
            },
            {
              mimeType: 'application/pdf',
              filename: 'ticket.pdf',
              body: { attachmentId: 'att-1', size: 12345 },
            },
            {
              mimeType: 'image/png',
              filename: 'logo.png',
              body: { attachmentId: 'att-2', size: 800 },
            },
            {
              mimeType: 'text/calendar',
              filename: 'event.ics',
              body: { attachmentId: 'att-3', size: 500 },
            },
          ],
        },
      })) as typeof globalThis.fetch;
    const r = await getMessageBody('token', 'mid-pdf');
    assert.equal(r.attachments.length, 1);
    assert.equal(r.attachments[0]?.attachmentId, 'att-1');
    assert.equal(r.attachments[0]?.filename, 'ticket.pdf');
    assert.equal(r.attachments[0]?.mimeType, 'application/pdf');
    assert.equal(r.attachments[0]?.size, 12345);
  });

  it('walks nested parts to find PDF attachments', async () => {
    globalThis.fetch = (async () =>
      jsonResponse({
        payload: {
          headers: [],
          mimeType: 'multipart/mixed',
          parts: [
            {
              mimeType: 'multipart/alternative',
              parts: [
                { mimeType: 'text/plain', body: { data: b64url('A'.repeat(200)) } },
              ],
            },
            {
              mimeType: 'multipart/related',
              parts: [
                {
                  mimeType: 'application/pdf',
                  filename: 'nested.pdf',
                  body: { attachmentId: 'nested-att', size: 5000 },
                },
              ],
            },
          ],
        },
      })) as typeof globalThis.fetch;
    const r = await getMessageBody('token', 'mid-nested-pdf');
    assert.equal(r.attachments.length, 1);
    assert.equal(r.attachments[0]?.attachmentId, 'nested-att');
  });

  it('returns the attached body field unchanged for old fixtures', async () => {
    globalThis.fetch = (async () =>
      jsonResponse({
        payload: {
          headers: [{ name: 'Subject', value: 'x' }],
          mimeType: 'text/plain',
          body: { data: b64url('A'.repeat(150)) },
        },
      })) as typeof globalThis.fetch;
    const r = await getMessageBody('token', 'mid-back-compat');
    assert.equal(r.body, 'A'.repeat(150));
    assert.deepEqual(r.attachments, []);
  });

  it('decodes html entities and replaces br/block tags with newlines', async () => {
    globalThis.fetch = (async () =>
      jsonResponse({
        payload: {
          headers: [],
          mimeType: 'text/html',
          body: {
            data: b64url(
              'Line one<br/>Line two<br>Line three' +
                '<p>Para</p>' +
                'AT&amp;T&nbsp;rocks &lt;ok&gt; &#39;',
            ),
          },
        },
      })) as typeof globalThis.fetch;
    const r = await getMessageBody('token', 'mid-6');
    assert.match(r.body, /Line one\nLine two\nLine three/);
    assert.match(r.body, /AT&T/);
    assert.match(r.body, /<ok>/);
  });
});

describe('getAttachment', () => {
  it('decodes base64url payload to a Buffer', async () => {
    const original = Buffer.from('%PDF-1.4 fake', 'utf8');
    const data = original
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    globalThis.fetch = (async () =>
      jsonResponse({ data })) as typeof globalThis.fetch;
    const buf = await getAttachment('t', 'mid', 'att-1');
    assert.ok(Buffer.isBuffer(buf));
    assert.equal(buf.toString('utf8'), '%PDF-1.4 fake');
  });

  it('throws GmailError when the response has no data field', async () => {
    globalThis.fetch = (async () =>
      jsonResponse({})) as typeof globalThis.fetch;
    await assert.rejects(getAttachment('t', 'mid', 'att-1'), (err: GmailError) => {
      assert.equal(err.name, 'GmailError');
      return true;
    });
  });

  it('throws GmailError on non-OK', async () => {
    globalThis.fetch = (async () =>
      new Response('nope', { status: 404 })) as typeof globalThis.fetch;
    await assert.rejects(getAttachment('t', 'mid', 'att-1'), (err: GmailError) => {
      assert.equal(err.status, 404);
      return true;
    });
  });
});
