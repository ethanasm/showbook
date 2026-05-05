/**
 * Unit tests for the Eventbrite client. Mocks globalThis.fetch.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { getMyPastOrders, EventbriteError } from '../eventbrite';

const ORIGINAL_FETCH = globalThis.fetch;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

function buildOrder(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'o1',
    status: 'placed',
    created: '2024-08-01T12:00:00Z',
    changed: '2024-08-01T12:00:00Z',
    event_id: 'e1',
    costs: { gross: { display: '$45.00' } },
    attendees: [{ ticket_class_name: 'GA' }, { ticket_class_name: 'GA' }],
    event: {
      id: 'e1',
      name: { text: 'Some Concert' },
      start: { local: '2024-08-23T20:00:00', timezone: 'America/New_York' },
      venue: {
        id: 'v1',
        name: 'Music Hall',
        address: { city: 'Brooklyn', region: 'NY' },
      },
      category: { name: 'Music' },
    },
    ...over,
  };
}

describe('getMyPastOrders', () => {
  it('maps orders to EventbriteTicket and stops paginating when has_more_items is false', async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return jsonResponse({
        pagination: { object_count: 1, page_count: 1, page_number: 1, page_size: 50, has_more_items: false },
        orders: [buildOrder()],
      });
    }) as typeof globalThis.fetch;
    const tickets = await getMyPastOrders('token');
    assert.equal(calls, 1);
    assert.equal(tickets.length, 1);
    const t = tickets[0]!;
    assert.equal(t.orderId, 'o1');
    assert.equal(t.eventId, 'e1');
    assert.equal(t.date, '2024-08-23');
    assert.equal(t.eventName, 'Some Concert');
    assert.equal(t.venueName, 'Music Hall');
    assert.equal(t.venueCity, 'Brooklyn');
    assert.equal(t.venueState, 'NY');
    assert.equal(t.price, '$45.00');
    assert.equal(t.ticketCount, 2);
    assert.equal(t.kindHint, 'concert'); // Music → concert
  });

  it('paginates using the continuation cursor', async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (url: string) => {
      calls.push(url);
      const isFirst = !url.includes('continuation=');
      return jsonResponse({
        pagination: {
          object_count: 2,
          page_count: 2,
          page_number: isFirst ? 1 : 2,
          page_size: 1,
          has_more_items: isFirst,
          continuation: isFirst ? 'cursor-2' : undefined,
        },
        orders: [
          buildOrder({
            id: isFirst ? 'a' : 'b',
            event_id: isFirst ? 'ea' : 'eb',
            event: {
              id: isFirst ? 'ea' : 'eb',
              name: { text: isFirst ? 'A' : 'B' },
              start: { local: '2024-09-01T20:00:00' },
              venue: { id: 'v', name: 'V', address: { city: 'C', region: 'R' } },
              category: { name: 'Comedy' },
            },
          }),
        ],
      });
    }) as typeof globalThis.fetch;
    const tickets = await getMyPastOrders('token');
    assert.equal(calls.length, 2);
    assert.match(calls[1] ?? '', /continuation=cursor-2/);
    assert.equal(tickets.length, 2);
    assert.equal(tickets[0]!.kindHint, 'comedy');
    assert.equal(tickets[1]!.eventId, 'eb');
  });

  it('respects maxPages cap', async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return jsonResponse({
        pagination: {
          object_count: 1,
          page_count: 999,
          page_number: calls,
          page_size: 1,
          has_more_items: true,
          continuation: 'cur',
        },
        orders: [buildOrder({ id: `o${calls}`, event_id: `e${calls}` })],
      });
    }) as typeof globalThis.fetch;
    const tickets = await getMyPastOrders('token', { maxPages: 3 });
    assert.equal(calls, 3);
    assert.equal(tickets.length, 3);
  });

  it('throws EventbriteError on non-OK', async () => {
    globalThis.fetch = (async () =>
      new Response('nope', { status: 401 })) as typeof globalThis.fetch;
    await assert.rejects(
      getMyPastOrders('token'),
      (err: unknown) => err instanceof EventbriteError && err.status === 401,
    );
  });

  it('skips orders missing an expanded event payload', async () => {
    globalThis.fetch = (async () =>
      jsonResponse({
        pagination: { has_more_items: false },
        orders: [
          { id: 'noevent', status: 'placed', created: '', changed: '', event_id: 'e' },
          buildOrder({ id: 'good' }),
        ],
      })) as typeof globalThis.fetch;
    const tickets = await getMyPastOrders('token');
    assert.equal(tickets.length, 1);
    assert.equal(tickets[0]!.orderId, 'good');
  });

  it('infers kind hint from category name', async () => {
    const cases: Array<[string, 'concert' | 'theatre' | 'comedy' | 'festival' | null]> = [
      ['Music', 'concert'],
      ['Comedy', 'comedy'],
      ['Performing Arts', 'theatre'],
      ['Theatre', 'theatre'],
      ['Festival of Lights', 'festival'],
      ['Sports', null],
    ];
    for (const [cat, expected] of cases) {
      globalThis.fetch = (async () =>
        jsonResponse({
          pagination: { has_more_items: false },
          orders: [
            buildOrder({
              event: {
                id: 'e',
                name: { text: 'X' },
                start: { local: '2024-01-01T20:00:00' },
                venue: { id: 'v', name: 'V', address: { city: 'C', region: 'R' } },
                category: { name: cat },
              },
            }),
          ],
        })) as typeof globalThis.fetch;
      const tickets = await getMyPastOrders('token');
      assert.equal(tickets[0]!.kindHint, expected, `category ${cat}`);
    }
  });
});
